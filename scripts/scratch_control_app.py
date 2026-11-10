"""Create or drop a scratch copy of CONTROL_APP (named CONTROL_APP_T21) from sql/09_agent_tools.sql, so temp agents
can exercise an UNDEPLOYED change to the tool. The live CONTROL_APP is never touched.

Usage: uv run python scripts/scratch_control_app.py create|drop|show
Then: CONTROL_APP_NAME=CONTROL_APP_T21 uv run python scripts/temp_agent.py create   (eval_agent.py honours it too)
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_config  # noqa: E402

import snowflake.connector  # noqa: E402

SCRATCH = "CONTROL_APP_T21"
ROOT = Path(__file__).resolve().parent.parent


def scratch_ddl(sql: str) -> str:
    m = re.search(r"CREATE OR REPLACE PROCEDURE CONTROL_APP\(.*?\n\$\$;", sql, re.S)
    assert m, "CONTROL_APP not found in sql/09_agent_tools.sql"
    return m.group(0).replace("PROCEDURE CONTROL_APP(", f"PROCEDURE {SCRATCH}(", 1).rstrip(";")


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "show"
    cfg = demo_config.load()
    conn = snowflake.connector.connect(connection_name=cfg["SNOWFLAKE_CONNECTION"], role=cfg["DEMO_ROLE"],
                                       warehouse=cfg["DEMO_WAREHOUSE"], database=cfg["DEMO_DATABASE"], schema=cfg["DEMO_SCHEMA"])
    cur = conn.cursor()
    try:
        if cmd == "create":
            cur.execute(scratch_ddl(demo_config.render_text((ROOT / "sql" / "09_agent_tools.sql").read_text(), demo_config.load())))
            print("created", SCRATCH)
        elif cmd == "drop":
            cur.execute(f"DROP PROCEDURE IF EXISTS {cfg['FQ_SCHEMA']}.{SCRATCH}(STRING, STRING, NUMBER, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, NUMBER, FLOAT, FLOAT, FLOAT)")
            cur.execute(f"DROP PROCEDURE IF EXISTS {cfg['FQ_SCHEMA']}.{SCRATCH}(STRING, STRING, NUMBER, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, STRING, NUMBER)")
            print("dropped", SCRATCH)
        cur.execute(f"SHOW PROCEDURES LIKE '{SCRATCH}' IN SCHEMA {cfg['FQ_SCHEMA']}")
        print("SHOW ->", [r[1] for r in cur.fetchall()] or "none")
    finally:
        conn.close()


if __name__ == "__main__":
    main(sys.argv)
