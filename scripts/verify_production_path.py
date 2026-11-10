"""Execute docs/production-path.md (sql/production_path/production_path.sql) in a scratch schema.

Creates SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_PROD_SCRATCH, runs every statement, uploads one 1-page file,
waits for the task to parse it (billed: 1 AGENTIC page per variant that fires), checks rows, search
and the agent, then tests the trigger variants and DROPs the schema (confirmed with SHOW).

Variants (the round-7 question: does a stream-gated task fire on an internal stage?):
  A  AUTO_REFRESH = TRUE stage, task WHEN SYSTEM$STREAM_HAS_DATA      (the documented path)
  B  AUTO_REFRESH = FALSE stage, same gated task, no manual refresh    (the agent's old example)
  C  AUTO_REFRESH = FALSE stage, task without WHEN, ALTER STAGE REFRESH inside the task body

Runs as ACCOUNTADMIN by default (VERIFY_ROLE): the demo role has no CREATE SCHEMA or EXECUTE TASK, on purpose.
Usage: uv run python scripts/verify_production_path.py [--variants A B C]
"""
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
import demo_config  # noqa: E402
_CFG = demo_config.load()
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = _CFG["DEMO_DATABASE"]
SCHEMA = f"{DB}.AGENTIC_PARSE_PROD_SCRATCH"
WH = _CFG["DEMO_WAREHOUSE"]  # the configured warehouse, not the default install's
FILE = ROOT / "corpus" / "receipt_photo.jpg"
PDF = ROOT / "corpus" / "stamped_invoice.pdf"  # 1 page


def statements(sql):
    """Split on ';' at end of line, keeping $$ blocks whole."""
    out, buf, in_dollar = [], [], False
    for line in sql.splitlines():
        if line.strip().startswith("--") and not in_dollar:
            continue
        if line.count("$$") % 2:
            in_dollar = not in_dollar
        buf.append(line)
        if not in_dollar and line.rstrip().endswith(";"):
            stmt = "\n".join(buf).strip().rstrip(";")
            if stmt:
                out.append(stmt)
            buf = []
    return out


def load_sql():
    s = (ROOT / "sql" / "production_path" / "production_path.sql").read_text()
    return s.replace("<SCHEMA>", SCHEMA).replace("<WH>", WH).replace("<DB>", DB)


def wait_rows(cur, table, n=1, timeout=420):
    t0 = time.time()
    while time.time() - t0 < timeout:
        got = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        if got >= n:
            return got, time.time() - t0
        time.sleep(15)
    return 0, time.time() - t0


def put(cur, stage):
    cur.execute(f"PUT 'file://{FILE}' @{stage} AUTO_COMPRESS=FALSE OVERWRITE=TRUE")


def variant(cur, name, sqls):
    """Fresh stage/stream/table/task per variant; returns (fired, seconds)."""
    auto = "TRUE" if name == "A" else "FALSE"
    st, stream, tbl, task = f"{SCHEMA}.V{name}_INBOX", f"{SCHEMA}.V{name}_NEW", f"{SCHEMA}.V{name}_PARSED", f"{SCHEMA}.V{name}_TASK"
    cur.execute(f"CREATE STAGE {st} ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE') DIRECTORY = (ENABLE = TRUE AUTO_REFRESH = {auto})")
    cur.execute(f"CREATE STREAM {stream} ON STAGE {st}")
    cur.execute(f"CREATE TABLE {tbl} (RELATIVE_PATH STRING, ERROR STRING)")
    body = (f"INSERT INTO {tbl} SELECT RELATIVE_PATH, r:error::STRING FROM (SELECT RELATIVE_PATH, "
            f"AI_PARSE_DOCUMENT(TO_FILE('@{st}', RELATIVE_PATH), OBJECT_CONSTRUCT('mode', 'AGENTIC'), TRUE) AS r "
            f"FROM {stream} WHERE METADATA$ACTION = 'INSERT')")
    if name == "C":
        cur.execute(f"CREATE TASK {task} WAREHOUSE = {WH} SCHEDULE = '1 MINUTE' AS\nBEGIN\n  ALTER STAGE {st} REFRESH;\n  {body};\nEND")
    else:
        cur.execute(f"CREATE TASK {task} WAREHOUSE = {WH} SCHEDULE = '1 MINUTE' WHEN SYSTEM$STREAM_HAS_DATA('{stream}') AS {body}")
    cur.execute(f"ALTER TASK {task} RESUME")
    put(cur, st)
    got, secs = wait_rows(cur, tbl, timeout=300 if name == "B" else 420)
    cur.execute(f"ALTER TASK {task} SUSPEND")
    runs = cur.execute(f"SELECT STATE, COUNT(*) FROM TABLE({DB}.INFORMATION_SCHEMA.TASK_HISTORY(TASK_NAME => 'V{name}_TASK')) GROUP BY 1").fetchall()
    return bool(got), round(secs), runs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variants", nargs="*", default=["A", "B", "C"])
    args = ap.parse_args()
    import snowflake.connector

    conn = snowflake.connector.connect(connection_name=_CFG["SNOWFLAKE_CONNECTION"],
                                       role=os.environ.get("VERIFY_ROLE", "ACCOUNTADMIN"), warehouse=WH, database=DB)
    cur = conn.cursor()
    report = {}
    try:
        cur.execute(f"CREATE SCHEMA {SCHEMA}")
        for stmt in statements(load_sql()):
            if stmt.startswith("SELECT t.QUERY_ID"):
                continue  # cost query runs after the parse
            cur.execute(stmt)
            print("OK:", stmt.splitlines()[0][:90], flush=True)
        put(cur, f"{SCHEMA}.INBOX")  # 1-page image
        cur.execute(f"PUT 'file://{PDF}' @{SCHEMA}.INBOX AUTO_COMPRESS=FALSE OVERWRITE=TRUE")  # 1-page PDF branch
        got, secs = wait_rows(cur, f"{SCHEMA}.PARSED_DOCS", n=2)
        rows = cur.execute(f"SELECT RELATIVE_PATH, ERROR, PAGE_COUNT, TYPEOF(RESULT) FROM {SCHEMA}.PARSED_DOCS ORDER BY 1").fetchall()
        pages = cur.execute(f"SELECT RELATIVE_PATH, COUNT(*), MAX(LENGTH(CONTENT)) FROM {SCHEMA}.PARSED_PAGES GROUP BY 1 ORDER BY 1").fetchall()
        report["main"] = {"parsed_after_s": round(secs), "rows": [list(map(str, r)) for r in rows], "pages": [list(map(str, p)) for p in pages]}
        assert got == 2 and all(r[1] is None for r in rows) and len(pages) == 2 and all(p[2] > 20 for p in pages), report["main"]
        cur.execute(f"ALTER TASK {SCHEMA}.PARSE_NEW_DOCS SUSPEND")
        cur.execute(f"ALTER CORTEX SEARCH SERVICE {SCHEMA}.PARSED_PAGES_SEARCH REFRESH")
        q = json.dumps({"query": "receipt total", "columns": ["RELATIVE_PATH", "PAGE_INDEX"], "limit": 1})
        hit = json.loads(cur.execute("SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW(%s, %s)", (f"{SCHEMA}.PARSED_PAGES_SEARCH", q)).fetchone()[0])
        report["search_hit"] = hit["results"][0]["RELATIVE_PATH"] if hit.get("results") else None
        body = {"messages": [{"role": "user", "content": [{"type": "text", "text": "What is the total on the receipt?"}]}]}
        raw = json.loads(cur.execute("SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(%s, %s)", (f"{SCHEMA}.DOCS_AGENT", json.dumps(body))).fetchone()[0])
        report["agent_answer"] = "".join(c.get("text", "") for c in raw.get("content", []) if c.get("type") == "text")[:300]
        cost_sql = [s for s in statements(load_sql()) if s.startswith("SELECT t.QUERY_ID")][0]
        report["cost_rows"] = [[str(x) for x in r] for r in cur.execute(cost_sql).fetchall()]
        for v in args.variants:
            fired, secs, runs = variant(cur, v, None)
            report[f"variant_{v}"] = {"fired": fired, "seconds_waited": secs, "task_history": runs}
            print("variant", v, report[f"variant_{v}"], flush=True)
    finally:
        cur.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
        left = cur.execute(f"SHOW SCHEMAS LIKE 'AGENTIC_PARSE_PROD_SCRATCH' IN DATABASE {DB}").fetchall()
        report["schema_dropped"] = len(left) == 0
        print(json.dumps(report, indent=2, default=str))
        conn.close()


if __name__ == "__main__":
    main()
