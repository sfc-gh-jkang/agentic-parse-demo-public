"""Create or drop scratch (_T21) copies of the value/data objects, rendered from the REAL DDL in sql/, so they can be tested
and exercised by temp agents before go-live. Live objects (and the live agents) are never touched.

Objects: VISUAL_DATA_POINTS, VALUE_CREDITS_PER_PAGE, VALUE_BY_DOC_MODE, VALUE_BY_MODE, VALUE_HARD_PAGES (sql/07b_value_and_data.sql),
procedure VALUE_STORY and semantic view PARSE_ANALYTICS (sql/09_agent_tools.sql), each with the suffix.
Usage: uv run python scripts/scratch_value.py create|drop|show      (SCRATCH_SUFFIX defaults to _T21)
Then:  SCRATCH_SUFFIX=_T21 uv run python scripts/temp_agent.py create   (eval_agent.py honours it too)
"""
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_config  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SUFFIX = os.environ.get("SCRATCH_SUFFIX", "_T21")
VIEWS = ["VISUAL_DATA_POINTS", "VALUE_CREDITS_PER_PAGE", "VALUE_BY_DOC_MODE", "VALUE_BY_MODE", "VALUE_HARD_PAGES"]
OTHERS = ["VALUE_STORY", "PARSE_ANALYTICS"]


def rename(sql: str, suffix: str = SUFFIX) -> str:
    for name in VIEWS + OTHERS:
        sql = re.sub(rf"\b{name}\b", name + suffix, sql)
    return sql


def statements(suffix: str = SUFFIX) -> list[str]:
    """The scratch DDL, one statement per item: 07b views, VALUE_STORY, PARSE_ANALYTICS."""
    cfg = demo_config.load()  # render config.env names, as setup.sh does for .build/sql
    v = demo_config.render_text((ROOT / "sql" / "07b_value_and_data.sql").read_text(), cfg)
    t = demo_config.render_text((ROOT / "sql" / "09_agent_tools.sql").read_text(), cfg)
    views = re.findall(r"CREATE OR REPLACE VIEW .*?;\n", v, re.S)
    proc = re.search(r"CREATE OR REPLACE PROCEDURE VALUE_STORY\(.*?\n\$\$;", t, re.S)
    sem = re.search(r"CREATE OR REPLACE SEMANTIC VIEW PARSE_ANALYTICS.*?;\n", t, re.S)
    assert len(views) == len(VIEWS) and proc and sem, "value DDL not found in sql/"
    return [rename(s.strip().rstrip(";"), suffix) for s in [*views, proc.group(0), sem.group(0)]]


def drops(fq: str, suffix: str = SUFFIX) -> list[str]:
    return ([f"DROP SEMANTIC VIEW IF EXISTS {fq}.PARSE_ANALYTICS{suffix}", f"DROP PROCEDURE IF EXISTS {fq}.VALUE_STORY{suffix}(NUMBER, FLOAT, FLOAT, FLOAT)", f"DROP PROCEDURE IF EXISTS {fq}.VALUE_STORY{suffix}(NUMBER, NUMBER, NUMBER, NUMBER)", f"DROP PROCEDURE IF EXISTS {fq}.VALUE_STORY{suffix}(NUMBER)"]
            + [f"DROP VIEW IF EXISTS {fq}.{n}{suffix}" for n in reversed(VIEWS)])


def main(argv):
    import snowflake.connector
    cmd = argv[1] if len(argv) > 1 else "show"
    cfg = demo_config.load()
    conn = snowflake.connector.connect(connection_name=cfg["SNOWFLAKE_CONNECTION"], role=cfg["DEMO_ROLE"],
                                       warehouse=cfg["DEMO_WAREHOUSE"], database=cfg["DEMO_DATABASE"], schema=cfg["DEMO_SCHEMA"])
    cur = conn.cursor()
    fq = cfg["FQ_SCHEMA"]
    try:
        if cmd == "create":
            for s in statements():
                cur.execute(s)
            print("created scratch objects with suffix", SUFFIX)
        elif cmd == "drop":
            for s in drops(fq):
                cur.execute(s)
            print("dropped scratch objects with suffix", SUFFIX)
        for kind, q in [("views", f"SHOW VIEWS LIKE '%{SUFFIX}' IN SCHEMA {fq}"), ("procedures", f"SHOW PROCEDURES LIKE '%{SUFFIX}' IN SCHEMA {fq}"),
                        ("semantic views", f"SHOW SEMANTIC VIEWS LIKE '%{SUFFIX}' IN SCHEMA {fq}")]:
            cur.execute(q)
            print(f"SHOW {kind} ->", [r[1] for r in cur.fetchall()] or "none")
    finally:
        conn.close()


if __name__ == "__main__":
    main(sys.argv)
