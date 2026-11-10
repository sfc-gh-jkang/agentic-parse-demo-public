# Testing

## Cross-account cold start: AWS US West 2 (2026-11-10)

AWS US West 2 account (AWS), ACCOUNTADMIN, PAT auth. `CORTEX_ENABLED_CROSS_REGION = ANY_REGION`. No `SNOWFLAKE_DOCUMENTATION` database. Source: anonymous clone of the public repo at `f92e777`, default names, docs/QUICKSTART.md followed as written.

Sequence: setup → verify → e2e + eval → teardown → verify gone → setup again from the same clone → verify → demo e2e. Outcome: **pass**. The second install is left running.

| check | result |
|---|---|
| preflight | DOCS_SEARCH auto → 0 with a WARN, setup continued |
| model probes (claude-sonnet-5-5, both agents) | OK in US West 2 |
| AGENTIC parse | 33 parse runs (11 docs × 3 modes) both installs |
| tables | DOCUMENTS 11, PARSE_RUNS 33, MODE_COMPARISONS 33, DESIGN_DOCS 112 |
| search services | DESIGN_DOCS_SEARCH, PARSED_DOCS_SEARCH ACTIVE/ACTIVE |
| semantic view, agents | PARSE_ANALYTICS; both agents, no docs tool (as designed) |
| SI listing | AGENTIC_PARSE_DEMO_SI_AGENT in SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT |
| app | RUNNING; setup ~16 min wall clock incl. build |
| PAT to App Runtime ingress | `Authorization: Snowflake Token="<PAT>"` → 200 (11 docs); no auth → 302. First live proof that a PAT is accepted directly |
| demo.e2e.mjs | PASS (install 1 and 2) |
| storyline.e2e.mjs | 10/11 then 11/11 after the fix below |
| onboarding.e2e.mjs WITH_AGENT=1 | 7/7 |
| eval_agent.py (Sonnet 5.5) | 38/38 pass, agentic_prompt and agentic_what SKIPPED (no docs tool) |
| teardown | schema, wh, role, SI listing, app gone (SHOW empty); unrelated schemas/agents/apps untouched; one DONE `SPCS_APP_BUILDER_JOB_*` left in `USER$<your_user>.PUBLIC` as teardown documents; no API integration is created by the demo |
| re-install | succeeds, new URL (expected) |
| AI credits (CORTEX_AI_FUNCTIONS_USAGE_HISTORY, lower bound due to lag) | AI_PARSE_DOCUMENT 0.617 for 2 corpus parses + e2e uploads; AI_COMPLETE 0.072 |

### Findings

| class | finding | fix |
|---|---|---|
| genuine bug (test) | storyline beat 3: on this account the headline answer was long enough that, after the chat auto-scrolls to the end, the collapsed "How I answered" header sat 87 px above a 360 px viewport. Deterministic (2/2 runs) | `web/e2e/storyline.e2e.mjs` scrolls the header into view before asserting, as a phone user would; 11/11 after |
| doc | QUICKSTART said "tested only on AWS US East 1" | updated |
| none (harness) | first setup was killed by the tester's tool timeout at the cost prompt; re-run with `--yes` resumed cleanly, which also exercised re-run idempotency of the pre-parse steps | — |

No account-state, missing-prerequisite, region/edition or cloud-divergence blockers.

### Not tested

- A genuine second person cloning and running on their own machine.
- A non-ACCOUNTADMIN installer (`SKIP_ADMIN=1`) on this account.
- The CKE docs path (`SNOWFLAKE_DOCUMENTATION` present) on this account.
- Azure and GCP.
- Visual review of screenshots (the tester's image reader returned placeholders).
