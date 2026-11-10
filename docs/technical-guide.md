# Technical guide

Detail behind the [README](../README.md): how the agent drives the app, the compare-answers chat, setup and deploy, presenter tools, tests, measured cost, the value panel and the pitfalls found while building it. Vocabulary follows [GLOSSARY.md](../GLOSSARY.md).

## The agent drives the app

Tell the Demo Agent what to show and it does it: "take me to the homepage", "open the claim packet", "go to page 3", "show me what LAYOUT sees", "compare agentic with OCR", "zoom in", "open the diagram", "what was missed?", "switch to dark mode", "take me to upload", "turn off the compare answers". "Explain that relations number" spotlights the score strip with a caption; "give me a tour of this screen" runs a 4 to 8 step guided tour (Next, Back, Close, Esc) grounded in [docs/app-guide.md](app-guide.md), which is loaded into the design-docs search so the agent explains each element with a citation.

One custom tool, `control_app`, backed by the side-effect-free procedure `CONTROL_APP` (sql/09_agent_tools.sql), validates the request and echoes it as JSON; the app applies it from the agent's SSE stream (`web/lib/app-actions.ts`, `web/components/agent/app-controller.tsx`, `spotlight.tsx`). Actions: go_home, open_document, set_page, set_view, set_mode, set_pair, select_visual, close_visual, zoom, show_missed, set_compare_answers, open_upload, set_theme, scroll, highlight, clear_highlight, tour; optional fields combine in one call; pages are 1-based. Spotlight targets are a fixed catalog of `data-tour="<name>"` elements (a vitest scan checks every catalog name exists in the code, in CONTROL_APP and in the App Guide). Every message carries an `[App state: ...]` line (route, Document, page, view, mode tab, pair, Visuals, zoom, panels, toggles, theme, spotlight, home Documents), so "where am I?" and "close that" need no names. A confirmed agent re-parse opens that Mode with a Live Result badge. Generic tools on a warehouse reject `array` arguments, so tour steps travel as a JSON string.

## Value chat: compare answers across modes

The headline moment. The Demo Agent panel (on every page) has a **Compare answers across modes** toggle, on by default and remembered per browser session. Under each agent reply the app calls `POST /api/ask {question, doc}`, in parallel with the agent so the agent answer is never delayed. The route runs `AI_COMPLETE('claude-sonnet-5-5', ?)` once per Parse Mode on that mode's latest stored parse text (AGENTIC also gets its Visual summaries and details), with the prompt bound as a parameter and the question capped at 500 characters. Each model answers only from that text, cites pages, and says "Not in this parse" otherwise. The table shows AGENTIC first and highlighted, page chips that move the viewer, and per-row latency. The Document is the one the question names, else the open one, else the first one the agent cites. Pure helpers: `web/lib/ask.ts`.

Cost: one small AI_COMPLETE per mode per question (three per question), measured on this account from `CORTEX_AI_FUNCTIONS_USAGE_HISTORY` joined to `QUERY_HISTORY` on the app's statement `SELECT AI_COMPLETE('claude-sonnet-5-5', ?)`, all of 2026-10-31 (account time): 0.0017 AI credits per call on average (795 calls, median 0.0012, max 0.0072; re-derived 2026-11-01), so about 0.005 AI credits per question. Turn the toggle off to skip it. AI_COMPLETE: https://docs.snowflake.com/en/sql-reference/functions/ai_complete-single-string

## Setup and deploy

`./setup.sh` does it all and is idempotent. Names come from `config.env` (gitignored; defaults in `config.env.example`): connection, database `SNOWFLAKE_EXAMPLE`, schema `AGENTIC_PARSE_DEMO`, role `AGENTIC_PARSE_DEMO_RL`, warehouse `SFE_AGENTIC_PARSE_DEMO_WH`, app `AGENTIC_PARSE_DEMO`. Committed files are written with those defaults; `python3 scripts/demo_config.py render` copies `sql/`, `scoring/` and `web/` into `.build/` with your names, and `setup.sh` runs the copy. The Python scripts and e2e scripts read the same config.

```bash
./setup.sh [--yes] [--skip-parse]   # preflight, sql/01..09b, Corpus upload, billed parse (asks), comparisons, search, agents, design docs, app
bash scripts/deploy.sh              # same, without the parse step (refresh after a code change)
./teardown.sh [--yes]               # drop the app, schema, warehouse, role and SI listing; verifies with SHOW
                                    # needs config.env; --yes on the default names also needs TEARDOWN_DEFAULT_NAMES=1
```

The parse step only runs Document/mode pairs without a stored run (`scripts/parse_corpus.py --missing`), so re-runs are free. Snowflake App Runtime: https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/about-snowflake-app-runtime . Find the URL with `SHOW APPLICATION SERVICES IN SCHEMA <db>.<schema>;` (column `url`).

After editing the README or anything under `docs/`, refresh what the agent can quote:

```bash
uv run python scripts/load_design_docs.py
snow sql -c <connection> --role AGENTIC_PARSE_DEMO_RL --warehouse SFE_AGENTIC_PARSE_DEMO_WH -q "ALTER CORTEX SEARCH SERVICE SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DESIGN_DOCS_SEARCH REFRESH"
```

(ALTER CORTEX SEARCH SERVICE: https://docs.snowflake.com/en/sql-reference/sql/alter-cortex-search)

## Presenter tools

- **Reset demo** (home page, confirm dialog): deletes every upload, clears chat, tour, highlight and theme. Runbook §4.
- **Pre-flight a customer document**: `uv run python scripts/preflight.py FILE [...] [--keep]` parses it in all three modes (billed), asks four generic questions per mode and writes a report of where AGENTIC wins or ties, with measured credits. Runbook §4b, example [docs/preflight-example.md](preflight-example.md).
- **Model guard**: `uv run python scripts/check_models.py` probes every pinned model with its real call shape. Runbook §1b.
- **Offline fallback**: `node scripts/record_walkthrough.mjs` records the talk-track path to `docs/walkthrough/`. Runbook §5b.
- **Industry packs**: `uv run python -m generator.corpus --pack insurance|manufacturing|finance` writes a re-themed Corpus (same structures, renamed companies, titles and labels; Ground Truth generated from the same literals) to `corpus_packs/<pack>/` (git-ignored, about 4 MB, 4 s). `--pack neutral` (default) is the committed `corpus/`, byte for byte (`tests/test_packs.py`). To demo a pack: `PACK=insurance ./setup.sh` (puts that pack on `@DOCS/corpus/` and re-registers its Ground Truth), then `uv run python scripts/parse_corpus.py` (billed: every Corpus page in three modes) so the stored runs match. Not run on the live demo; the live Corpus is neutral. To go back: `./setup.sh` (re-parse the neutral Corpus).

## Tests

```bash
uv run pytest -q                         # non-live: generator determinism, scorer, eval checks (live tests skip)
LIVE=1 uv run pytest -q                  # live against the configured connection, ~11 min; bills 5 pages (tests/test_parse_core.py: 2 AGENTIC, 2 OCR, 1 LAYOUT, ~0.02 AI credits)
cd web && npx vitest run && npx tsc --noEmit

# Agent eval (native DATA_AGENT_RUN against temp agent copies; no reparse): writes docs/model-eval.md
uv run python scripts/eval_agent.py --models claude-sonnet-5-5 claude-opus-5-5

# End to end against the deployed app. Spends one 1-page AGENTIC parse; deletes the upload after.
SNOWFLAKE_PRIVATE_KEY_PATH=~/.snowflake/keys/<key>.p8 uv run python scripts/app_token.py > /tmp/.app_tok
(cd web && APP_TOKEN_FILE=/tmp/.app_tok node e2e/demo.e2e.mjs)
# 22-turn presenter conversation: the agent drives every control and gives a tour; no billed parses.
(cd web && APP_TOKEN_FILE=/tmp/.app_tok node e2e/control.e2e.mjs)
# Presenter controls (badge, presenter chips, status line, Reset demo); stores one unparsed upload, no billed parse.
(cd web && APP_TOKEN_FILE=/tmp/.app_tok node e2e/reset.e2e.mjs); rm /tmp/.app_tok
```

`scripts/app_token.py` signs a key-pair JWT and exchanges it at `/oauth/token` for a token scoped to the app host, sent as `Authorization: Snowflake Token="..."`. It holds no secrets; the key path comes from the environment. With a PAT connection skip it: `export SNOWFLAKE_PAT=<token>` and the e2e scripts send the PAT itself as the same header (https://docs.snowflake.com/en/developer-guide/snowpark-container-services/tutorials/advanced/tutorial-8-access-public-endpoint-programmatically); the PAT is read from the environment only and never printed or written. The e2e scripts use `playwright` from `web/` devDependencies (`cd web && npm ci && npx playwright install chromium`; set `PLAYWRIGHT_MODULE` to override) and read `APP_HOST`, the connection and names from `config.env`. Screenshots land in `docs/screenshots/`.

## Measured cost

From `PARSE_COST` (source `SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY`, https://docs.snowflake.com/en/sql-reference/account-usage/cortex_ai_functions_usage_history), measured on this account, all stored Corpus runs, 2026-10-30:

| Parse Mode | AI credits per 1,000 pages |
|---|---|
| OCR | 0.68 |
| LAYOUT | 3.66 |
| AGENTIC | 8.18 |

AI credits only, warehouse credits excluded. The AGENTIC per-page rate is not published in the docs; this is a measurement, not a price list. Usage rows can lag a few minutes; runs not yet in the view are shown as pending, never estimated. Re-derive with `CALL SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.PARSE_COST(NULL);`.

## Value and data

The home page has a **What AGENTIC is worth** panel computed from stored data by `VALUE_STORY` (sql/09_agent_tools.sql, on the views in sql/07b_value_and_data.sql): measured credits per page, facts and relations recovered, pages a person would still check by hand, and **credits per correct fact** = measured credits per page x pages in the scored Corpus, divided by facts found. On this Corpus OCR is cheapest per correct fact (0.0000346 credits against 0.000402 for AGENTIC, 11.6 times); AGENTIC leaves 6 of 24 pages to check by hand (OCR 15, LAYOUT 14) and recovers 123 of 125 relations (OCR 59, LAYOUT 85). A volume box turns the measured rates into monthly AI credits and expected facts per Parse Mode, labelled an estimate. The view `VISUAL_DATA_POINTS` flattens every chart value AGENTIC read into one row (31 across the Corpus) and is in the `PARSE_ANALYTICS` semantic view; each Document page has a **Use this data** tab with runnable SQL (read-only snippets run through a fixed allowlist; the AI_EXTRACT snippet is billed and asks first; the Dynamic Table snippet is a pattern, not run).

## Limits

- AGENTIC is in **Public Preview**: output schemas are best effort and may change.
- AGENTIC **accepts no user prompt or schema**; you cannot steer what it extracts. The agent is instructed to say so.
- `extract_images` is never set with AGENTIC (the two docs pages disagree on whether it is ignored or an error).
- Uploads: PDF, PPTX, DOCX, PNG, JPG, TIFF; 10 MB; 20 pages; enforced in `UPLOAD_DOCUMENT`. Uploaded Documents have no Ground Truth, so no scores.
- Visuals detected and typed is 15/28 (54%) on this Corpus (docs/stage2-report.md); AGENTIC is not a perfect detector, and the demo shows its misses.

## Pitfalls

- **Never `npm run build` while `npm run dev` runs** in `web/`: both write `.next/` and the dev server breaks.
- **`DOCUMENTS.PAGES` can be NULL** (sql/03_register_corpus.sql never sets it, so it is NULL for all 11 Corpus rows; DOCX uploads have no reliable page count). Use `DOCUMENT_CATALOG`, which falls back to the parsed page count.
- **Snowflake Intelligence agent:** two agents are generated from one template (`sql/templates/agent_spec.yaml.tmpl`, `python3 scripts/gen_agents_sql.py` writes `sql/09b_agents.sql`; a test fails if the file is stale). `AGENTIC_PARSE_DEMO_AGENT` has `control_app` and is what the web app calls. `AGENTIC_PARSE_DEMO_SI_AGENT` has the same tools minus `control_app` and instructions that say it has no screen; it is the only agent listed in Snowflake Intelligence, because an agent that can call a screen tool outside the app sometimes claimed it had moved the screen. Every deploy runs `ALTER SNOWFLAKE INTELLIGENCE ... ADD AGENT` for the SI agent (ignores 400203, already listed) and `DROP AGENT` for the app agent (ignores the not-listed error). Both agents are owned by `AGENTIC_PARSE_DEMO_RL`. Syntax: https://docs.snowflake.com/en/user-guide/snowflake-cortex/snowflake-cowork/deploy-agents CREATE AGENT: https://docs.snowflake.com/en/sql-reference/sql/create-agent
- The docs example `PARSE_JSON(AI_PARSE_DOCUMENT(...))` does not compile on current accounts (the function returns OBJECT); use `:` path access.
- A cold live AGENTIC parse has been observed at 189 s; see the runbook fallback.
