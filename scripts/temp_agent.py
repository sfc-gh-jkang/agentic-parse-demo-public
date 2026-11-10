"""Create or drop a temp copy of the demo agent from the current sql/09b_agents.sql spec (live agents untouched).

Usage: uv run python scripts/temp_agent.py create|drop|show [NAME]   (default NAME AGENTIC_PARSE_DEMO_AGENT_T21_FLOW)
Point the local app at it with: DEMO_AGENT_NAME=<NAME> npm run dev   (web/lib/agent-config.ts)
"""
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
import demo_config  # noqa: E402
_CFG = demo_config.load()
import sys

import snowflake.connector

from eval_agent import MODELS, agent_spec

DEFAULT = "AGENTIC_PARSE_DEMO_AGENT_T21_FLOW"
LIVE = {"AGENTIC_PARSE_DEMO_AGENT", "AGENTIC_PARSE_DEMO_SI_AGENT"}


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "show"
    name = (argv[2] if len(argv) > 2 else DEFAULT).upper()
    if name in LIVE:
        sys.exit(f"refusing to touch live agent {name}")
    fqn = f"{_CFG['FQ_SCHEMA']}.{name}"
    conn = snowflake.connector.connect(connection_name=_CFG["SNOWFLAKE_CONNECTION"], role=_CFG["DEMO_ROLE"],
                                       warehouse=_CFG["DEMO_WAREHOUSE"], database=_CFG["DEMO_DATABASE"], schema=_CFG["DEMO_SCHEMA"])
    cur = conn.cursor()
    try:
        if cmd == "create":
            cur.execute(f"CREATE OR REPLACE AGENT {fqn} FROM SPECIFICATION $$\n{agent_spec(MODELS[0])}\n$$")
            print("created", fqn)
        elif cmd == "drop":
            cur.execute(f"DROP AGENT IF EXISTS {fqn}")
            print("dropped", fqn)
        cur.execute(f"SHOW AGENTS LIKE '{name}' IN SCHEMA {_CFG['FQ_SCHEMA']}")
        print("SHOW ->", [r[1] for r in cur.fetchall()] or "none")
    finally:
        conn.close()


if __name__ == "__main__":
    main(sys.argv)
