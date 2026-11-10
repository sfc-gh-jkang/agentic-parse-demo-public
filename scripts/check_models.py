"""Model guard: probe every pinned model with the call shape it really uses; exit 1 if any fails.

Pins are found by grep, not a hand-kept list:
- agent orchestration models: `orchestration: <model>` in sql/09b_agents.sql (per agent), probed with
  SNOWFLAKE.CORTEX.DATA_AGENT_RUN on the live agent (also checks the live spec still has that pin);
- AI_COMPLETE models: `AI_COMPLETE('<model>'` in code, or `ASK_MODEL = "<model>"` (web/lib/ask.ts), probed
  with AI_COMPLETE(model, prompt) like web/app/api/ask/route.ts.
Then reports newer versions in the same family that answer (report only; pins are never changed).

Usage: uv run python scripts/check_models.py      (connection SNOWFLAKE_CONNECTION, default from config.env)
Cost: one tiny AI_COMPLETE per model/candidate and one short agent run per agent.
"""
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
import demo_config  # noqa: E402
_CFG = demo_config.load()
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
S = _CFG["FQ_SCHEMA"]
CODE_GLOBS = ["web/app/**/*.ts", "web/lib/**/*.ts", "sql/*.sql", "scripts/*.py", "scoring/*.py"]


def agent_pins(sql_text=None):
    """{agent name: model} from sql/09b_agents.sql."""
    sql_text = sql_text if sql_text is not None else (ROOT / "sql" / "09b_agents.sql").read_text()
    out = {}
    for m in re.finditer(r"CREATE OR REPLACE AGENT (\w+).*?^  orchestration: (\S+)$", sql_text, re.S | re.M):
        out[m.group(1)] = m.group(2)
    return out


def complete_pins(files=None):
    """{model: [file, ...]} for AI_COMPLETE pins in code."""
    out = {}
    paths = files if files is not None else [p for g in CODE_GLOBS for p in ROOT.glob(g) if p.name != "check_models.py"]
    for p in paths:
        text = Path(p).read_text(errors="ignore")
        for m in re.findall(r"AI_COMPLETE\(\s*'([a-z0-9][\w.-]+)'", text) + re.findall(r'ASK_MODEL = "([\w.-]+)"', text):
            out.setdefault(m, []).append(str(Path(p).relative_to(ROOT)) if Path(p).is_absolute() else str(p))
    return out


def candidates(model):
    """Plausible newer versions of the same family, e.g. claude-sonnet-5-5 -> 5-6, 6, 6-0, 6-5."""
    m = re.fullmatch(r"(claude-[a-z]+)-(\d+)-(\d+)", model)
    if not m:
        return []
    fam, major, minor = m.group(1), int(m.group(2)), int(m.group(3))
    return [f"{fam}-{major}-{minor + 1}", f"{fam}-{major + 1}", f"{fam}-{major + 1}-0", f"{fam}-{major + 1}-5"]


def probe_complete(cur, model):
    try:
        cur.execute("SELECT AI_COMPLETE(%s, %s)", (model, "Reply with the single word OK."))
        return True, str(cur.fetchone()[0]).strip()[:40]
    except Exception as e:
        return False, str(e).splitlines()[0][:160]


def probe_agent(cur, agent, model):
    cur.execute(f"DESCRIBE AGENT {S}.{agent}")
    cols = [c[0].lower() for c in cur.description]
    spec = str(dict(zip(cols, cur.fetchone())).get("agent_spec", ""))
    if model not in spec:
        return False, f"live spec does not pin {model}; redeploy sql/09b_agents.sql"
    body = {"messages": [{"role": "user", "content": [{"type": "text", "text": "Reply with the single word OK. Do not use tools."}]}]}
    try:
        cur.execute("SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(%s, %s)", (f"{S}.{agent}", json.dumps(body)))
        raw = json.loads(cur.fetchone()[0])
        text = "".join(c.get("text", "") for c in raw.get("content", []) if c.get("type") == "text").strip()
        return bool(text), text[:40] or "empty answer"
    except Exception as e:
        return False, str(e).splitlines()[0][:160]


def connect(cfg=None, connector=None):
    """Open the connection, or exit non-zero with a plain message when it is not configured or cannot be opened."""
    import snowflake.connector

    cfg = cfg or _CFG
    name = cfg.get("SNOWFLAKE_CONNECTION", "")
    try:
        return (connector or snowflake.connector).connect(
            connection_name=name, role=cfg["DEMO_ROLE"], warehouse=cfg["DEMO_WAREHOUSE"],
            database=cfg["DEMO_DATABASE"], schema=cfg["DEMO_SCHEMA"])
    except Exception as e:
        sys.exit(f"Could not open Snowflake connection '{name}': {str(e).splitlines()[0][:200]}\n"
                 "Set up config.env (copy config.env.example, set SNOWFLAKE_CONNECTION) and a working `snow` connection first "
                 f"(`snow connection test -c {name or '<name>'}`).")


def main():
    conn = connect()
    cur = conn.cursor()
    failed = False
    pinned = set()
    for agent, model in agent_pins().items():
        ok, info = probe_agent(cur, agent, model)
        pinned.add(model)
        failed |= not ok
        print(f"{'OK  ' if ok else 'FAIL'} agent {agent} orchestration {model}: {info}")
    for model, files in complete_pins().items():
        ok, info = probe_complete(cur, model)
        pinned.add(model)
        failed |= not ok
        print(f"{'OK  ' if ok else 'FAIL'} AI_COMPLETE {model} ({', '.join(sorted(set(files)))}): {info}")
    for model in sorted(pinned):
        newer = [c for c in candidates(model) if probe_complete(cur, c)[0]]
        print(f"newer than {model}: {', '.join(newer) if newer else 'none available'} (report only; pin unchanged)")
    conn.close()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
