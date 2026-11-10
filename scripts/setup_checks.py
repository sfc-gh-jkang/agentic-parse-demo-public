"""Preflight checks for setup.sh. Exit 1 on a blocking problem; warnings print and continue.

  account   region, cross-region inference, admin role, Snowflake Documentation share   (before install)
  models    AI_COMPLETE probe of every pinned model as the demo role                    (after sql/01_setup.sql)
  cost      Corpus page count and the measured parse cost per mode                      (before the billed parse)
"""
import glob
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_config  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# AI credits per 1,000 pages, measured on the author's demo account, Oct 2026 (docs/stage2-report.md).
RATE_PER_1K = {"OCR": 0.68, "LAYOUT": 3.66, "AGENTIC": 8.18}


DOCS_HELP = (
    "To get it (free): in Snowsight open Marketplace, search for \"cortex knowledge extension snowflake documentation\", "
    "open the listing \"Cortex Knowledge Extension: Snowflake Documentation\" by Snowflake, click Get, and name the database "
    "SNOWFLAKE_DOCUMENTATION. Steps: https://www.snowflake.com/en/developers/guides/get-started-snowflake-cortex-knowledge-extensions/ "
    "(about CKEs: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-knowledge-extensions/cke-overview)."
)


def docs_check(cfg, has_db: bool, save=None) -> int:
    """Handle the Snowflake Documentation database. DOCS_SEARCH: auto (default), 1 = require it, 0 = never use it.

    Returns 1 (blocking) only when DOCS_SEARCH=1 and the database is missing. With auto and no database it prints how to
    get it, sets DOCS_SEARCH=0 through save(key, value) (config.env) and lets setup continue without the docs tool.
    """
    mode = str(cfg.get("DOCS_SEARCH", "auto")).strip().lower()
    if mode in ("0", "false", "no", "off"):
        print("DOCS_SEARCH=0: installing the agents without the Snowflake documentation tool.")
        return 0
    if has_db:
        print("OK   database SNOWFLAKE_DOCUMENTATION found: the agents get the Snowflake documentation tool.")
        return 0
    if mode in ("1", "true", "yes", "on"):
        print("FAIL database SNOWFLAKE_DOCUMENTATION not found and DOCS_SEARCH=1 requires it. " + DOCS_HELP +
              " Or set DOCS_SEARCH=0 (or auto) in config.env to install without the docs tool.")
        return 1
    print("WARN database SNOWFLAKE_DOCUMENTATION not found. Continuing WITHOUT the agents' Snowflake documentation tool "
          "(setting DOCS_SEARCH=0 in config.env). " + DOCS_HELP +
          " Later: install it, set DOCS_SEARCH=auto in config.env and re-run ./setup.sh (idempotent) to add the tool.")
    if save:
        save("DOCS_SEARCH", "0")
    return 0


def account(cfg) -> int:
    import snowflake.connector

    bad = 0
    with snowflake.connector.connect(connection_name=cfg["SNOWFLAKE_CONNECTION"]) as conn:
        cur = conn.cursor()
        region, user, roles = cur.execute(
            "SELECT CURRENT_REGION(), CURRENT_USER(), CURRENT_AVAILABLE_ROLES()").fetchone()
        print(f"connection {cfg['SNOWFLAKE_CONNECTION']}: user {user}, region {region}")
        if cfg.get("SKIP_ADMIN") != "1":
            if '"ACCOUNTADMIN"' not in roles:
                print("FAIL user cannot use ACCOUNTADMIN. Ask an admin to run .build/sql/01_setup.sql "
                      "(python3 scripts/demo_config.py render), then set SKIP_ADMIN=1 in config.env.")
                bad = 1
            else:
                cur.execute("USE ROLE ACCOUNTADMIN")
                rows = cur.execute("SHOW PARAMETERS LIKE 'CORTEX_ENABLED_CROSS_REGION' IN ACCOUNT").fetchall()
                val = rows[0][1] if rows else "unknown"
                print(f"CORTEX_ENABLED_CROSS_REGION = {val}")
                if val in ("DISABLED", "unknown"):
                    print("WARN cross-region inference is off. If AI_PARSE_DOCUMENT AGENTIC or the agent models are "
                          "not available in this region, enable it: "
                          "https://docs.snowflake.com/en/user-guide/snowflake-cortex/cross-region-inference")
        elif f'"{cfg["DEMO_ROLE"]}"' not in roles:
            print(f"FAIL SKIP_ADMIN=1 but role {cfg['DEMO_ROLE']} is not granted to {user}")
            bad = 1
        if str(cfg.get("DOCS_SEARCH", "auto")).strip().lower() in ("0", "false", "no", "off"):
            has_db = False
        else:
            has_db = bool(cur.execute("SHOW DATABASES LIKE 'SNOWFLAKE_DOCUMENTATION'").fetchall())
        bad |= docs_check(cfg, has_db, demo_config.set_config_value)
    return bad


def models(cfg) -> int:
    import check_models

    bad = 0
    with demo_config.connect(schema=False) as conn:
        cur = conn.cursor()
        for model in check_models.complete_pins():
            ok, info = check_models.probe_complete(cur, model)
            print(f"{'OK  ' if ok else 'FAIL'} AI_COMPLETE {model}: {info}")
            bad |= not ok
        for agent, model in check_models.agent_pins().items():
            ok, info = check_models.probe_complete(cur, model)
            print(f"{'OK  ' if ok else 'FAIL'} agent {agent} model {model} (AI_COMPLETE probe): {info}")
            bad |= not ok
    if bad:
        print("A pinned model is not available here. Enable cross-region inference or change the pin "
              "(sql/templates/agent_spec.yaml.tmpl, web/lib/ask.ts).")
    return int(bad)


def cost(corpus_dir: str = "corpus") -> int:
    from pypdf import PdfReader

    pages = sum(len(PdfReader(f).pages) for f in glob.glob(str(ROOT / corpus_dir / "*.pdf")))
    total = 0.0
    print(f"Corpus: {pages} pages, parsed once in each of 3 modes.")
    for mode, rate in RATE_PER_1K.items():
        c = pages * rate / 1000
        total += c
        print(f"  {mode:8} {rate:5.2f} AI credits / 1,000 pages -> {c:.3f}")
    print(f"  total about {total:.2f} AI credits (rates measured on the author's demo account, Oct 2026; "
          "your account's rates may differ)")
    return 0


if __name__ == "__main__":
    c = demo_config.load()
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    sys.exit({"account": lambda: account(c), "models": lambda: models(c),
              "cost": lambda: cost(*sys.argv[2:3])}.get(cmd, lambda: print(__doc__) or 2)())
