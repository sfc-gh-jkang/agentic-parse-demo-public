# Audits (T14)

Run 2026-10-30 (evening ET) on the author's demo account (AWS US East 1), role `AGENTIC_PARSE_DEMO_RL`, schema `SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO`. Doc links were taken from `cortex search docs` results or from links already in the repo that came from it; none were hand-built.

## (a) Architecture Claim Audit

Each headline claim needs (1) the object is the claimed type on the live account, (2) serving code references that object, (3) usage history shows it ran. Query-history counts are successful queries on `SFE_AGENTIC_PARSE_DEMO_WH` in `SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY` over the last 2 days, matched on query text, last seen 2026-10-30 18:12 PST.

| Claim | (1) Object on account | (2) Code that uses it | (3) It ran | Result |
|---|---|---|---|---|
| AI_PARSE_DOCUMENT in OCR, LAYOUT, AGENTIC | Function call inside `PARSE_DOCUMENT` proc (`sql/02_parse_core.sql`, mode validated to the three values, lines 96-113) | `APP_PARSE` (sql/07_upload.sql) ← `web/app/api/documents/[id]/parse/route.ts`; agent tool `REPARSE` (sql/09) | `CORTEX_AI_FUNCTIONS_USAGE_HISTORY`, last 3 days: `AI_PARSE_DOCUMENT` model `ocr` 16 rows, `layout` 17, `agentic` 28. Query history: 79 queries containing `AI_PARSE_DOCUMENT(`, 34 `CALL APP_PARSE`. `PARSE_RUNS`: OCR 17, LAYOUT 17, AGENTIC 18 | Pass |
| Cortex Search, parsed documents | `SHOW CORTEX SEARCH SERVICES`: `PARSED_DOCS_SEARCH`, indexing ACTIVE, serving ACTIVE | Agent spec tool `parsed_documents` (sql/09_agent_tools.sql:348) | 98 queries referencing it; agent eval tool trace shows `parsed_documents` | Pass |
| Cortex Search, design docs | `DESIGN_DOCS_SEARCH`, ACTIVE/ACTIVE | Agent tool `design_docs` (sql/09:358) | 44 queries; eval `why_persist`, `glossary_parse_run` used `design_docs` | Pass |
| Snowflake docs search (CKE) | `SNOWFLAKE_DOCUMENTATION.SHARED.CKE_SNOWFLAKE_DOCS_SERVICE`, ACTIVE/ACTIVE | Agent tool `snowflake_docs` (sql/09:363) | Eval `agentic_what` used `snowflake_docs`. Not visible in this warehouse's query history (the service lives in a shared database) | Pass (evidence: agent tool trace) |
| Cortex Agent | `SHOW AGENTS`: `AGENTIC_PARSE_DEMO_AGENT` | `web/app/api/agent/route.ts:9` calls `/agents/AGENTIC_PARSE_DEMO_AGENT:run` | `CORTEX_AGENT_USAGE_HISTORY`: 17 rows for this agent in 3 days, last 18:13 PST; e2e chat steps passed against the deployed app | Pass |
| Cortex Analyst over a semantic view | `SHOW SEMANTIC VIEWS`: `PARSE_ANALYTICS` | Agent tool `parse_analytics`, `semantic_view: ...PARSE_ANALYTICS` (sql/09:384) | 27 queries referencing it; eval `best_relations` used `parse_analytics` + `system_execute_sql` | Pass |
| Snowflake App Runtime | `SHOW APPLICATION SERVICES IN SCHEMA`: `AGENTIC_PARSE_DEMO`, status RUNNING, url set | `web/` deployed with `snow app deploy` | e2e PASS against that URL; 48/48 warm-up requests HTTP 200 | Pass |
| Snowflake Intelligence | `SHOW AGENTS IN SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT` lists only `AGENTIC_PARSE_DEMO_SI_AGENT` (no `control_app`); the app agent is not listed (2026-10-31) | sql/09b_agents.sql (generated) adds the SI agent and drops the app agent from SI | 12 live SI-agent answers (6 prompts x 2): none claimed a moved screen, facts 4,286.50 and 13.8 correct (`tests/test_si_agent_live.py`) | **Registered, answers verified via `DATA_AGENT_RUN`**; still no SI UI usage in `SNOWFLAKE_INTELLIGENCE_USAGE_HISTORY`, so say "listed in Snowflake Intelligence" until John asks one question there |
| Measured cost from CORTEX_AI_FUNCTIONS_USAGE_HISTORY | View `PARSE_RUN_COST` + proc `PARSE_COST` (sql/05_parse_cost.sql) read `SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY` joined on query id | `web/app/api/cost/route.ts`; agent tool `MEASURED_COST` (sql/09:377) | 9 queries referencing the view; `CALL PARSE_COST(NULL)` returned 17/16/16 measured runs, 0 pending | Pass |

No claim was deleted. The Snowflake Intelligence wording in the README and talk track is "also listed in Snowflake Intelligence", which the evidence supports.

## (b) Executable Content Audit

E = executed 2026-10-30, output checked. N = not executed, with reason. No snippet needed compile-only treatment as account-wide DDL.

| Where | Snippet | Status |
|---|---|---|
| README | `bash scripts/deploy.sh` | N in T14: re-runs ACCOUNTADMIN setup and replaces both search services and the agent; not needed for this ticket and unchanged since T13, which ran it. Its last two steps (design-docs loader + `DESIGN_DOCS_SEARCH` refresh) were executed in T14 |
| README | `uv run python scripts/parse_corpus.py` | N: bills every Corpus Document in three modes (all stored runs so far cost 0.42 AI credits); only needed on a fresh account |
| README | `snow app deploy --connection <your-connection> --role AGENTIC_PARSE_DEMO_RL --warehouse SFE_AGENTIC_PARSE_DEMO_WH` | N: no app code changed in T14, so no redeploy |
| README | `SHOW APPLICATION SERVICES IN SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO;` | E: RUNNING |
| README | `load_design_docs.py` + `ALTER CORTEX SEARCH SERVICE ... DESIGN_DOCS_SEARCH REFRESH` | E |
| README | `uv run pytest -q` | E: 41 passed, 85 skipped |
| README | `LIVE=1 uv run pytest -q` | E: 126 passed in 10 min 47 s after one test fix (below). Found that it bills 5 pages; README said "no billed parses" and was corrected |
| README | `npx vitest run && npx tsc --noEmit` | E: 17 files / 179 tests passed; tsc clean |
| README | `scripts/eval_agent.py --models claude-sonnet-5-5` | E: 12/12 (two-model report in docs/model-eval.md kept) |
| README / runbook | `scripts/app_token.py` + `node e2e/demo.e2e.mjs` | E: PASS, 7 steps; cleanup verified (0 rows, no stage file) |
| README | `CALL ...PARSE_COST(NULL);` | E |
| runbook §1 | both `SHOW` statements | E |
| runbook §2 | warm-up loop | E: 48/48 HTTP 200, slowest 1.6 s |
| runbook §4 | `SELECT ... WHERE SOURCE = 'upload'` | E: 1 row (`up_memo_5f62b0`, from T13) |
| runbook §4 | reset statements | E in scoped form: the e2e cleanup runs the same DELETE / REMOVE / REFRESH statements filtered to `up_e2e_fixture_%` and left 0 rows. The unscoped form was not run, to keep T13's upload for John to inspect |
| README pitfall | `PARSE_JSON(AI_PARSE_DOCUMENT(...))` fails | Not re-run in T14; established in Stage 2 and guarded by the regression test in `tests/` |
| README pitfall (brief) | "COPY GRANTS rejected on agent" | E in a scratch agent `T14_SCRATCH_AGENT` (dropped, `SHOW` confirmed gone): `CREATE OR REPLACE AGENT ... COPY GRANTS FROM SPECIFICATION` **succeeded**, both fresh and replacing. Not reproduced, so the pitfall was not written into the README; the README instead states what sql/09 does about Snowflake Intelligence |

## (c) Citation Audit

| Figure | Where used | Source (re-derived 2026-10-30) |
|---|---|---|
| 0.68 / 3.66 / 8.18 AI credits per 1,000 pages | README, runbook, talk track | `CALL PARSE_COST(NULL)`: OCR 0.023120 cr / 34 pages, LAYOUT 0.106140 / 29, AGENTIC 0.286300 / 35. Measured 19:15 PDT, before the LIVE=1 test runs landed in usage history, so the next measurement may move slightly |
| ~0.008 AI credits per 1-page AGENTIC parse | runbook, talk track | 8.18 / 1000, derived |
| 0.29 AI credits, 35 AGENTIC pages billed so far | runbook | PARSE_COST AGENTIC row |
| ~0.02 AI credits for LIVE=1 tests | README | (2×8.18 + 2×0.68 + 1×3.66) / 1000 = 0.0214, assumes quarterly_report is 2 pages and stamped_invoice 1 (PARSE_RUNS.PAGE_COUNT) |
| 0.42 AI credits, all stored runs | this file | 0.2863 + 0.10614 + 0.02312 from PARSE_COST |
| 2.2x LAYOUT, 12x OCR | talk track | 8.18/3.66 = 2.23; 8.18/0.68 = 12.0 |
| Relations 123/85/59 of 125; facts inside images 238/221/166 of 244; Visuals 15/28 | README, talk track | `scripts/report.py` regenerated docs/stage2-report.md; every accuracy figure unchanged (only AGENTIC run count 16 → 17) |
| quarterly_report: LAYOUT 4/31, OCR 25/31 and 1/13, AGENTIC 30/31 and 13/13 | talk track | docs/stage2-report.md per-Document table |
| 11 Corpus Documents | talk track | `DOCUMENTS` where SOURCE = 'corpus': 11 |
| 12/12 eval | talk track | `scripts/eval_agent.py --models claude-sonnet-5-5` output, reproduced below |
| 189 s cold live parse | README, runbook, talk track | John's observation (T14 brief); not re-measured |
| ~33 s 1-page upload + AGENTIC parse | runbook | e2e step timing, this run (32.9 s) |
| 10 MB / 20 pages limits | README, talk track | sql/07_upload.sql `MAX_BYTES`, `MAX_PAGES` |
| Release date 2026-10-28 | README, talk track | release note https://docs.snowflake.com/en/release-notes/2026/other/2026-10-28-ai-parse-document-agentic-mode-preview |

### Eval output (2026-10-30, claude-sonnet-5-5)

```text
claude-sonnet-5-5 invoice_number PASS 11.7s ['parsed_documents', 'control_viewer']
claude-sonnet-5-5 floor_plan_link PASS 12.5s ['parsed_documents', 'control_viewer']
claude-sonnet-5-5 revenue_q4 PASS 17.1s ['parsed_documents', 'control_viewer']
claude-sonnet-5-5 why_persist PASS 15.0s ['design_docs']
claude-sonnet-5-5 glossary_parse_run PASS 7.7s ['design_docs']
claude-sonnet-5-5 agentic_prompt PASS 5.2s []
claude-sonnet-5-5 agentic_what PASS 10.6s ['snowflake_docs']
claude-sonnet-5-5 cost_all_modes PASS 10.8s ['measured_cost']
claude-sonnet-5-5 best_relations PASS 10.7s ['parse_analytics', 'system_execute_sql', 'system_execute_sql']
claude-sonnet-5-5 viewer_compare PASS 8.8s ['control_viewer']
claude-sonnet-5-5 viewer_page PASS 10.8s ['control_viewer']
claude-sonnet-5-5 invented_number PASS 15.1s ['parsed_documents', 'measured_cost', 'control_viewer']
```

## (d) Doc links used

All from `cortex search docs` output (or repo links that came from it):

- https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode
- https://docs.snowflake.com/en/sql-reference/functions/ai_parse_document
- https://docs.snowflake.com/en/release-notes/2026/other/2026-10-28-ai-parse-document-agentic-mode-preview
- https://docs.snowflake.com/en/user-guide/snowflake-cortex/pricing
- https://docs.snowflake.com/en/sql-reference/account-usage/cortex_ai_functions_usage_history
- https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/about-snowflake-app-runtime
- https://docs.snowflake.com/en/sql-reference/sql/alter-cortex-search
- https://docs.snowflake.com/en/sql-reference/sql/create-agent

`cortex search docs` returned no dedicated Snowflake Intelligence page for "Snowflake Intelligence" or "ALTER SNOWFLAKE INTELLIGENCE ADD AGENT"; that is not evidence the page does not exist (it indexes docs.snowflake.com only), so no SI link is cited rather than a guessed one.

## Fixes made during T14

- `tests/test_agent_tools.py::test_semantic_view_counts_documents` hardcoded 11 Documents and failed once T13's upload existed; it now compares with `DOCUMENT_CATALOG`.
- `scripts/app_token.py` retries: the first token exchange of the evening returned 390144 "JWT token is invalid", a retry seconds later succeeded.
- README: LIVE tests do bill (5 pages); COPY GRANTS pitfall not reproduced, not included.

No app bug was found by the e2e run, so no redeploy.

## Pass 5 (T21): value panel, volume, VISUAL_DATA_POINTS, Use this data

Run 2026-11-05 on the author's demo account, role `AGENTIC_PARSE_DEMO_RL`, against scratch copies (`_T21`) of the new objects; the real DDL is in `sql/07b_value_and_data.sql` and `sql/09_agent_tools.sql`.

Executable content (what ran, what did not):

| Content | Executed? | Evidence |
|---|---|---|
| Snippets `pages`, `visual_rows`, `search` | Yes, verbatim, read-only | `tests/test_use_data_snippets.py` (7 passed, 1 skipped by default); `visual_rows` returned the 13 quarterly_report values incl. Q3 = 13.8 |
| Snippet `ai_extract` (billed) | Yes, once, `RUN_BILLED=1`, query id `01c8361e-0a1a-4947-000d-1bfb333e8b2a` | Returned title "Northwind Analytics, Inc. - FY26 Business Review". Metered: 305 tokens, 0.00169275 credits (`CORTEX_AI_FUNCTIONS_USAGE_HISTORY`, model `arctic-extract`) = 5.55 credits per million tokens on that one call |
| Snippet `dynamic_table` | Yes, pass 6, on a scratch copy (`PAGE_FIELDS_T21`, one page, then dropped and confirmed with `SHOW DYNAMIC TABLES`) | `SHOW DYNAMIC TABLES`: `refresh_mode` INCREMENTAL (mode requested AUTO); creation refresh INCREMENTAL, 1 row inserted; `ALTER DYNAMIC TABLE ... REFRESH` with nothing new = NO_DATA, no AI call. Metered: query `01c836e1-0a1a-4da4-000d-1bfb334086ba`, 148 tokens, 0.0008214 credits (`CORTEX_AI_FUNCTIONS_USAGE_HISTORY`, `arctic-extract`). The pattern's `p.MODE` is a real column of the `PARSE_PAGES` view; the SELECT body is compile-checked by `test_every_snippet_compiles_against_the_real_schema` |
| `VALUE_STORY`, `VISUAL_DATA_POINTS`, views, semantic view | Yes, on `_T21` copies | `tests/test_visual_data_points.py` (7 passed): 31/31 Ground Truth chart points found, unique POINT_IDs, one run per Document, derivation recomputed from `PARSE_RUN_COST` and `MODE_COMPARISONS`, bad volume rejected, DDL re-run idempotent |
| `CONTROL_APP` with `VOLUME` | Yes, `CONTROL_APP_T21` | Live agent calls in the evals and e2e below |

Numbers shown in the app, from `VALUE_STORY` (24 scored pages, 494 facts, 125 relations): credits per correct fact = measured credits per page x 24 pages / facts found: OCR 0.00068 x 24 / 472 = 0.0000346; LAYOUT 0.00366 x 24 / 416 = 0.000211; AGENTIC 0.00818 x 24 / 488 = 0.000402. Pages to check by hand: 15, 14, 6 of 24. The "route hard pages" figure (0.155 credits against 0.196) is an oracle estimate and says so. Volume figures are pages x measured credits per page (50,000 pages: AGENTIC 409, LAYOUT 183, OCR 34 credits) and are labelled an estimate from measured rates on this corpus.

Docs: https://docs.snowflake.com/en/sql-reference/functions/ai_extract (billing by pages, input and output tokens; a paged-file page counts 970 tokens), https://docs.snowflake.com/en/user-guide/snowflake-cortex/pricing ("AI Credits per million tokens, rate varies by model"; no per-token rate is published there, so the rate shown in the app is measured from this account's usage history), https://docs.snowflake.com/en/user-guide/dynamic-tables/supported-queries, https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document, https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search.


## Pass 6 (T21): cost including review, Dynamic Table snippet executed

| Content | Executed? | Evidence |
|---|---|---|
| Every Use this data snippet (SQL and `input_sql`) | Compile-checked with `EXPLAIN USING TEXT` against the real schema (the Dynamic Table pattern as its SELECT body) | `tests/test_use_data_snippets.py::test_every_snippet_compiles_against_the_real_schema` |
| Dynamic Table pattern | Run once on a `_T21` scratch copy (see the row above) | refresh_mode INCREMENTAL observed 2026-11-05; 0.0008214 credits |
| `VALUE_STORY(pages, review_minutes, hourly_rate, price_per_credit)` | Yes, `_T21` copy | `tests/test_review_assumptions.py` (13 passed): per-Mode hours, cost, credits cost, total and hours saved recomputed independently from the story's own pages-to-check; no price = no money for credits and no total; decimals preserved (the parameters are FLOAT: a `NUMBER` parameter is NUMBER(38,0) and silently rounded 2.5 to 3) |
| `CONTROL_APP` with `REVIEW_MINUTES`, `HOURLY_RATE`, `CREDIT_PRICE` | Yes, `CONTROL_APP_T21` | same file; eval `value_review_5min_60h` |

The review figures are the reader's own assumptions applied to rates measured on this corpus. Nothing is a default: the boxes are empty, no price per credit is hardcoded, and credits become money only if the reader enters a price. Example with 5 minutes, 60 an hour, 50,000 pages a month (pages to check = pages to check / 24 corpus pages x 50,000): AGENTIC 12,500 pages, 1,041.7 hours, 62,500 review cost, 409 credits; LAYOUT 29,166.7 pages, 2,430.6 hours, 145,833; 183 credits; OCR 31,250 pages, 2,604.2 hours, 156,250, 34 credits. Hours AGENTIC saves: 1,388.9 against LAYOUT, 1,562.5 against OCR. With a price of 2 per credit (a number typed in for the test, not a Snowflake price) the totals are AGENTIC 63,318, LAYOUT 146,199, OCR 156,318.

Docs: https://docs.snowflake.com/en/user-guide/dynamic-tables/supported-queries (Cortex AI functions in dynamic table queries).
