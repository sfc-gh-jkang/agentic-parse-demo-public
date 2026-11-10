# Sharing the demo

Two ways to let another SE use it. Nothing here was run against another user or account; statements are labelled.

## 1. Give another SE access to this deployment

Everything (app, agents, procedures, stage, tables) is owned by `AGENTIC_PARSE_DEMO_RL`, so one role grant is enough. Run as SECURITYADMIN (or a role that can grant it). Compile-checked 2026-11-01 with an existing user, **not executed**:

```sql
GRANT ROLE AGENTIC_PARSE_DEMO_RL TO USER <their_user>;
```

GRANT ROLE: https://docs.snowflake.com/en/sql-reference/sql/grant-role . Granting roles to users: https://docs.snowflake.com/en/user-guide/security-access-control-configure

They then open the app URL (runbook §1) and sign in. That role can also re-parse (billed), upload, and run RESET_DEMO, which deletes every upload; say so when you hand it over. To give view-only access to the app endpoint instead of the role, App Runtime supports `GRANT USAGE ON APPLICATION SERVICE ... TO ROLE <role>` (https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/access-control); the app's queries run as the service, so viewers would see the same data. Not tested here.

## 2. Deploy a copy into another account

Prerequisites in the target account:

- A user that can `USE ROLE ACCOUNTADMIN` (sql/01_setup.sql creates the role, warehouse, database grants and turns on what AI_PARSE_DOCUMENT needs).
- AI_PARSE_DOCUMENT AGENTIC mode available in that region (Public Preview, https://docs.snowflake.com/en/release-notes/2026/other/2026-10-28-ai-parse-document-agentic-mode-preview), Cortex Agents and Cortex Search, and Snowflake App Runtime (https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/about-snowflake-app-runtime).
- The `SNOWFLAKE_DOCUMENTATION` share imported, for the agent's `snowflake_docs` tool.
- Local: `snow` CLI, `uv`, Node 20+, and a `connections.toml` entry for that account (key-pair or PAT auth).

Steps (same as the README; run with their connection name):

```bash
SNOWFLAKE_CONNECTION=<their_conn> bash scripts/deploy.sh             # objects, Corpus, search, agents, design docs
SNOWFLAKE_CONNECTION=<their_conn> uv run python scripts/parse_corpus.py   # bills every Corpus page in three modes once
cd web && snow app deploy --connection <their_conn> --role AGENTIC_PARSE_DEMO_RL --warehouse SFE_AGENTIC_PARSE_DEMO_WH
```

These were executed on this account (the author's demo account) only; not in another account. The cost per mode is re-measured in the new account by `PARSE_COST`; expect it to match the README but do not quote it until it does. Then run `uv run python scripts/check_models.py` (models available in that region) and the runbook checklist.
