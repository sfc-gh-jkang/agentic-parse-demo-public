"""Live: VISUAL_DATA_POINTS scored against Ground Truth chart points, and VALUE_STORY recomputed from the base tables.
Run against scratch copies before go-live: SCRATCH_SUFFIX=_T21 (scripts/scratch_value.py create). Unset = the deployed objects."""
import json
import os
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.live

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
SFX = os.environ.get("SCRATCH_SUFFIX", "")


@pytest.fixture(scope="module")
def cur():
    import demo_config
    import snowflake.connector
    cfg = demo_config.load()
    conn = snowflake.connector.connect(connection_name=cfg["SNOWFLAKE_CONNECTION"], role=cfg["DEMO_ROLE"],
                                       warehouse=cfg["DEMO_WAREHOUSE"], database=cfg["DEMO_DATABASE"], schema=cfg["DEMO_SCHEMA"])
    c = conn.cursor()
    try:
        c.execute(f"SELECT COUNT(*) FROM VISUAL_DATA_POINTS{SFX}")
    except Exception:
        pytest.skip("VISUAL_DATA_POINTS not deployed; create the scratch copy first")
    yield c
    conn.close()


def gt_points(cur):
    cur.execute("SELECT DOC_ID, TO_JSON(GROUND_TRUTH:visuals) FROM DOCUMENTS WHERE GROUND_TRUTH IS NOT NULL AND SOURCE <> 'fixture'")
    for doc, vis in cur.fetchall():
        for v in json.loads(vis or "[]"):
            if v.get("image_type") != "chart":
                continue
            for s in v.get("series", []):
                for p in s["points"]:
                    yield doc, v["page"], v.get("title"), str(p["x"]), float(p["y"])


def test_rows_have_the_documented_columns_and_unique_ids(cur):
    cur.execute(f"SELECT * FROM VISUAL_DATA_POINTS{SFX} LIMIT 1")
    assert [d[0] for d in cur.description] == ["POINT_ID", "DOC_ID", "PAGE_INDEX", "PAGE_NUMBER", "VISUAL_ID", "MODE", "RUN_ID", "CHART_TITLE",
                                               "CHART_TYPE", "LABEL", "SERIES", "VALUE", "VALUE_TEXT", "UNIT"]
    cur.execute(f"SELECT COUNT(*), COUNT(DISTINCT POINT_ID), COUNT_IF(MODE <> 'AGENTIC'), COUNT_IF(VALUE IS NULL) FROM VISUAL_DATA_POINTS{SFX}")
    n, distinct, non_agentic, null_values = cur.fetchone()
    assert n == distinct > 0 and non_agentic == 0 and null_values == 0


def test_only_the_latest_agentic_run_contributes(cur):
    cur.execute(f"SELECT COUNT(DISTINCT v.RUN_ID) = COUNT(DISTINCT v.DOC_ID) FROM VISUAL_DATA_POINTS{SFX} v")
    assert cur.fetchone()[0] is True  # one run per Document: older runs would repeat every value


def test_scored_against_ground_truth_chart_points(cur):
    cur.execute(f"SELECT DOC_ID, PAGE_INDEX, LABEL, VALUE FROM VISUAL_DATA_POINTS{SFX}")
    rows = cur.fetchall()
    expected = list(gt_points(cur))
    assert len(expected) >= 30
    found = missed = 0
    misses = []
    for doc, page, title, label, y in expected:
        hit = any(r[0] == doc and r[1] == page and r[2] == label and abs(r[3] - y) <= max(0.051, abs(y) * 0.001) for r in rows)
        found += hit
        if not hit:
            missed += 1
            misses.append((doc, page, title, label, y))
    print(f"VISUAL_DATA_POINTS recall vs Ground Truth chart points: {found}/{len(expected)}; misses {misses}")
    assert found / len(expected) >= 0.9
    # the headline the demo uses, exactly
    assert any(r[0] == "quarterly_report" and r[2] == "Q3" and r[3] == 13.8 for r in rows)


def test_value_story_matches_the_base_tables(cur):
    cur.execute(f"CALL VALUE_STORY{SFX}(50000)")
    story = json.loads(cur.fetchone()[0])
    cur.execute("SELECT MODE, SUM(CREDITS), SUM(PAGES_BILLED) FROM PARSE_RUN_COST WHERE CREDITS IS NOT NULL AND NOT PENDING GROUP BY MODE")
    rate = {m: float(c) / float(p) for m, c, p in cur.fetchall()}
    cur.execute("SELECT c.MODE, SUM(d.PAGES), SUM(IMAGE_FACTS_FOUND + TEXT_FACTS_FOUND), SUM(RELATIONS_FOUND) FROM MODE_COMPARISONS c "
                "JOIN DOCUMENT_CATALOG d USING (DOC_ID) GROUP BY c.MODE")
    base = {m: (int(p), int(f), int(r)) for m, p, f, r in cur.fetchall()}
    assert {m["mode"] for m in story["modes"]} == {"OCR", "LAYOUT", "AGENTIC"}
    for m in story["modes"]:
        pages, found, rel = base[m["mode"]]
        assert m["credits_per_page"] == pytest.approx(rate[m["mode"]], rel=1e-6)
        assert (m["corpus_pages"], m["facts_found"], m["relations_found"]) == (pages, found, rel)
        assert m["cost_per_correct_fact"] == pytest.approx(pages * rate[m["mode"]] / found, rel=1e-6)
        assert str(found) in m["derivation"] and "credits per correct fact" in m["derivation"]
    monthly = {x["mode"]: x for x in story["monthly"]["modes"]}
    for m in story["modes"]:
        assert monthly[m["mode"]]["monthly_credits"] == pytest.approx(50000 * m["credits_per_page"], rel=1e-9)
        assert monthly[m["mode"]]["expected_facts_recovered"] == pytest.approx(50000 * m["facts_found"] / m["corpus_pages"], rel=1e-9)
    assert story["monthly"]["label"] == "estimate from measured rates on this corpus"
    # the control Document: a cheaper Mode matched AGENTIC there
    control = {c["doc"]: c for c in story["control_docs"]}
    assert control["control_contract"]["cheapest_mode"] in ("OCR", "LAYOUT") and control["control_contract"]["agentic_credits_multiple"] > 1


def test_value_story_rejects_a_bad_volume(cur):
    for bad in (0, -5, 2_000_000_000):
        cur.execute(f"CALL VALUE_STORY{SFX}({bad})")
        assert "error" in json.loads(cur.fetchone()[0])


def test_ddl_is_idempotent(cur):
    cur.execute(f"SELECT COUNT(*) FROM VISUAL_DATA_POINTS{SFX}")
    before = cur.fetchone()[0]
    import scratch_value
    for s in scratch_value.statements(SFX or "_T21"):
        if SFX:  # only ever re-run the scratch copies
            cur.execute(s)
    cur.execute(f"SELECT COUNT(*) FROM VISUAL_DATA_POINTS{SFX}")
    assert cur.fetchone()[0] == before
