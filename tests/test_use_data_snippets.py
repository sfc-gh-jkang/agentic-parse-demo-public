"""The "Use this data" snippets are executed VERBATIM (the exact text the tab shows), not paraphrased.
Live read-only queries against the demo schema. The new view VISUAL_DATA_POINTS exists only as a scratch copy until go-live, so
set SCRATCH_SUFFIX=_T21 (scripts/scratch_value.py create) to retarget it; unset, the tests need the deployed view.
The billed AI_EXTRACT snippet runs only with RUN_BILLED=1 (one page of text, a few thousand tokens). The Dynamic Table
snippet is a pattern: it is checked for its labelling and is NEVER executed here.
"""
import json
import os
import re
import sys
from pathlib import Path

import pytest

import demo_config  # noqa: E402  (scripts/ is on sys.path via conftest)

pytestmark = pytest.mark.live

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
SNIPPETS = json.loads((ROOT / "web" / "lib" / "use-data-snippets.json").read_text())
SUFFIX = os.environ.get("SCRATCH_SUFFIX", "")
DOC = "quarterly_report"


def render(sql: str, doc: str = DOC) -> str:
    # The JSON holds the default names (setup.sh renders web/ into .build/); render config.env names the same way.
    sql = demo_config.render_text(sql.replace("{doc}", doc), demo_config.load())
    return re.sub(r"\bVISUAL_DATA_POINTS\b", f"VISUAL_DATA_POINTS{SUFFIX}", sql) if SUFFIX else sql


@pytest.fixture(scope="module")
def cur():
    import demo_config
    import snowflake.connector
    cfg = demo_config.load()
    conn = snowflake.connector.connect(connection_name=cfg["SNOWFLAKE_CONNECTION"], role=cfg["DEMO_ROLE"],
                                       warehouse=cfg["DEMO_WAREHOUSE"], database=cfg["DEMO_DATABASE"], schema=cfg["DEMO_SCHEMA"])
    yield conn.cursor()
    conn.close()


def snippet(sid):
    return next(s for s in SNIPPETS["snippets"] if s["id"] == sid)


def test_kinds_and_doc_links_are_the_allowed_ones():
    kinds = {s["id"]: s["kind"] for s in SNIPPETS["snippets"]}
    assert kinds == {"pages": "read", "visual_rows": "read", "search": "read", "ai_extract": "billed", "dynamic_table": "pattern"}
    allowed = {"https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document",
               "https://docs.snowflake.com/en/sql-reference/functions/ai_extract",
               "https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search",
               "https://docs.snowflake.com/en/user-guide/dynamic-tables/supported-queries"}
    assert set(SNIPPETS["doc_links"].values()) == allowed


def test_read_snippets_never_write():
    for s in SNIPPETS["snippets"]:
        if s["kind"] != "pattern":
            assert re.match(r"(?is)\s*SELECT\b", s["sql"]) and not re.search(r"(?i)\b(INSERT|UPDATE|DELETE|MERGE|DROP|CREATE|ALTER|CALL|GRANT)\b", s["sql"])


def test_dynamic_table_is_a_pattern_not_run_here():
    s = snippet("dynamic_table")
    assert s["kind"] == "pattern" and "Pattern, not run here" in s["blurb"] and s["sql"].startswith("CREATE OR REPLACE DYNAMIC TABLE")


def test_pages_snippet(cur):
    cur.execute(render(snippet("pages")["sql"]))
    rows = cur.fetchall()
    assert [r[0] for r in rows] == [1, 2] and all(r[1] > 0 for r in rows)


def test_visual_rows_snippet_returns_chart_values_as_rows(cur):
    cur.execute(render(snippet("visual_rows")["sql"]))
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    assert cols == ["PAGE_NUMBER", "CHART_TITLE", "SERIES", "LABEL", "VALUE", "UNIT"]
    q3 = [r for r in rows if r[3] == "Q3" and r[1] == "Quarterly Revenue (USD millions)"]
    assert len(q3) == 1 and q3[0][4] == 13.8
    assert len(rows) == 13  # 4 revenue + 6 customers + 3 regional share


def test_search_snippet(cur):
    cur.execute(render(snippet("search")["sql"]))
    results = json.loads(cur.fetchone()[0])
    assert 1 <= len(results) <= 3 and all({"CHUNK", "PAGE", "KIND"} <= set(r) for r in results)


def test_ai_extract_input_is_the_page_text(cur):
    cur.execute(render(snippet("ai_extract")["input_sql"]))
    assert len(cur.fetchone()[0]) > 100


@pytest.mark.skipif(os.environ.get("RUN_BILLED") != "1", reason="billed: set RUN_BILLED=1")
def test_ai_extract_snippet_billed(cur):
    cur.execute(render(snippet("ai_extract")["sql"]))
    extracted = json.loads(cur.fetchone()[0])
    print("AI_EXTRACT ->", json.dumps(extracted)[:400], "query id", cur.sfqid)
    assert "response" in extracted or "title" in json.dumps(extracted)


def test_every_snippet_compiles_against_the_real_schema(cur):
    """EXPLAIN compiles without running (no AI call is made). The Dynamic Table pattern is checked as its SELECT body, with the
    placeholders the reader replaces left out, so a column that does not exist (e.g. a wrong PARSE_PAGES column) fails here."""
    for s in SNIPPETS["snippets"]:
        sql = render(s["sql"])
        if s["kind"] == "pattern":
            assert re.search(r"CREATE OR REPLACE DYNAMIC TABLE MY_DB\.MY_SCHEMA\.\w+", sql), s["id"]
            sql = re.split(r"\bAS\s*\n", sql, maxsplit=1)[1]
        cur.execute("EXPLAIN USING TEXT " + sql)
        assert cur.fetchall(), s["id"]
        if s.get("input_sql"):
            cur.execute("EXPLAIN USING TEXT " + render(s["input_sql"]))
            assert cur.fetchall(), s["id"]
