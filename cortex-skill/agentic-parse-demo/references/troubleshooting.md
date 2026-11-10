# Troubleshooting

Names below come from `config.env` (`python3 scripts/demo_config.py get <KEY>`).

| Symptom | Check | Fix |
|---|---|---|
| `setup_checks.py account` FAIL: no ACCOUNTADMIN | `SELECT CURRENT_AVAILABLE_ROLES()` | An admin runs `.build/sql/01_setup.sql` (`python3 scripts/demo_config.py render` first), then set `SKIP_ADMIN=1` |
| WARN: SNOWFLAKE_DOCUMENTATION not found (setup continues, `DOCS_SEARCH=0`) | `SHOW DATABASES LIKE 'SNOWFLAKE_DOCUMENTATION'` | Optional. To add the docs tool: get "Cortex Knowledge Extension: Snowflake Documentation" from Marketplace (database name `SNOWFLAKE_DOCUMENTATION`; https://www.snowflake.com/en/developers/guides/get-started-snowflake-cortex-knowledge-extensions/), set `DOCS_SEARCH=auto` in `config.env`, re-run `./setup.sh` |
| Model FAIL in `setup_checks.py models` or `scripts/check_models.py` | region and `CORTEX_ENABLED_CROSS_REGION` | Enable cross-region inference: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cross-region-inference |
| AGENTIC parse errors | `SELECT MODE, ERROR FROM <FQ_SCHEMA>.PARSE_RUNS WHERE ERROR IS NOT NULL` | AGENTIC is Public Preview (https://docs.snowflake.com/en/release-notes/2026/other/2026-10-28-ai-parse-document-agentic-mode-preview); check region availability in https://docs.snowflake.com/en/sql-reference/functions/ai_parse_document |
| `snow app deploy` fails | `snow --version`, then the deploy output | Upgrade the CLI; https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/getting-started |
| App URL empty or app down | `SHOW APPLICATION SERVICES IN SCHEMA <FQ_SCHEMA>` | Status PENDING: wait. SUSPENDED: `ALTER APPLICATION SERVICE <FQ_SCHEMA>.<APP_NAME> RESUME`. FAILED: re-run `./setup.sh --skip-parse` |
| Agent answers but cannot find documents | `SHOW CORTEX SEARCH SERVICES IN SCHEMA <FQ_SCHEMA>` | `ALTER CORTEX SEARCH SERVICE <FQ_SCHEMA>.PARSED_DOCS_SEARCH REFRESH` |
| Comparisons empty | `SELECT COUNT(*) FROM <FQ_SCHEMA>.PARSE_RUNS` | Corpus not parsed: `./setup.sh` (asks before billing) |
| App URL changed | App service was recreated (teardown + reinstall) | Expected; re-share the new URL. To redeploy use `snow app deploy`, never drop the service |
| Headless test 401/302 with a PAT | `echo ${SNOWFLAKE_PAT:+set}` | PAT user needs a network policy allowing your IP and the app's service role; token goes in the env only |
| Headless test 390144 JWT invalid | key fingerprint on the user | `scripts/app_token.py` retries; check `SNOWFLAKE_PRIVATE_KEY_PATH` matches the user's public key |

More: `docs/runbook.md` (pre-demo checks), `docs/operating-cost.md` (idle cost, how to suspend).

## Snowsight objects

`snowsight/install.sql` also creates `SNOWFLAKE_EXAMPLE.PUBLIC.AGENTIC_PARSE_DEMO_REPO` (git clone) and the API
integration `AGENTIC_PARSE_DEMO_GIT_API`. After `./teardown.sh`, drop them as ACCOUNTADMIN:
`DROP GIT REPOSITORY IF EXISTS SNOWFLAKE_EXAMPLE.PUBLIC.AGENTIC_PARSE_DEMO_REPO; DROP API INTEGRATION IF EXISTS AGENTIC_PARSE_DEMO_GIT_API;`
