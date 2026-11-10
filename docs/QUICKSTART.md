# Quickstart: compare AI_PARSE_DOCUMENT OCR, LAYOUT and AGENTIC modes

## Overview

AI_PARSE_DOCUMENT turns documents into text and structure. Its **AGENTIC** mode (Public Preview, released 2026-10-28: https://docs.snowflake.com/en/release-notes/2026/other/2026-10-28-ai-parse-document-agentic-mode-preview) goes further on charts, diagrams, stamps, forms and photos: it finds each visual and returns what it means, for example a chart's series as a table. This guide installs a demo that parses one small synthetic corpus in all three modes, scores each mode against ground truth, and shows the results in a web app on Snowflake App Runtime with a Cortex Agent that answers with citations.

Docs: AI_PARSE_DOCUMENT https://docs.snowflake.com/en/sql-reference/functions/ai_parse_document , parse modes https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document , Snowflake App Runtime https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/about-snowflake-app-runtime .

## What you'll build

- A schema (default `SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO`) with a stage of 11 synthetic documents (22 pages) and their ground truth, a table of every parse run, scoring procedures and a measured-cost view.
- Two Cortex Search services, a semantic view, and two Cortex Agents (one drives the app, one is listed in Snowflake Intelligence).
- A Next.js app (application service) that shows each page with the visuals AGENTIC found, side-by-side mode comparisons, uploads, and the agent chat.

## Prerequisites

- **Account:** a Snowflake account where Cortex AI functions and AI_PARSE_DOCUMENT AGENTIC are available. If your region does not host a model the demo uses, enable cross-region inference: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cross-region-inference . Tested on the author's SE demo accounts in AWS US East 1 and AWS US West 2 (cold start, see `TESTING.md`); check the AI_PARSE_DOCUMENT page for region availability.
- **Privileges:** a user that can use ACCOUNTADMIN (creates the role, warehouse, schema, grants `SNOWFLAKE.CORTEX_USER`, lists the agent in Snowflake Intelligence). Without it, an admin runs the rendered `.build/sql/01_setup.sql` once and you set `SKIP_ADMIN=1` (the Snowflake Intelligence listing is then skipped).
- **Snowflake Documentation knowledge extension (optional):** the agents' Snowflake docs tool reads `SNOWFLAKE_DOCUMENTATION.SHARED.CKE_SNOWFLAKE_DOCS_SERVICE`. To get it (free), open Marketplace in Snowsight, search for "cortex knowledge extension snowflake documentation", open "Cortex Knowledge Extension: Snowflake Documentation" by Snowflake, click Get and keep the database name `SNOWFLAKE_DOCUMENTATION` (steps: https://www.snowflake.com/en/developers/guides/get-started-snowflake-cortex-knowledge-extensions/ ; about CKEs: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-knowledge-extensions/cke-overview). Without it, preflight says so, sets `DOCS_SEARCH=0` in `config.env` and setup continues: the agents are installed without the docs tool (everything else works; questions about Snowflake product behaviour are no longer answered from the docs). Install the database later, set `DOCS_SEARCH=auto` and re-run `./setup.sh` to add the tool. `DOCS_SEARCH=1` makes the database mandatory.
- **Local tools:** Snowflake CLI (tested with 3.31.0, https://docs.snowflake.com/en/developer-guide/snowflake-cli/installation/installation), Node.js 20+, uv, git. A CLI connection that authenticates without a browser (key-pair or programmatic access token, PAT). `setup.sh`, `teardown.sh` and the data-side scripts only use the connection through `snow -c` / the Python connector, so any auth the connection supports works. Only the optional headless app tests (`scripts/app_token.py`, `web/e2e/*`) need extra credentials: with a PAT, `export SNOWFLAKE_PAT=<token>` (environment only, never in a file); with a key pair, `SNOWFLAKE_PRIVATE_KEY_PATH` etc. in `config.env`.
- **Cost** (measured on the author's demo account, Oct 2026; your rates may differ): parsing the corpus once in all three modes is about 0.28 AI credits (OCR 0.68, LAYOUT 3.66, AGENTIC 8.18 AI credits per 1,000 pages, from `CORTEX_AI_FUNCTIONS_USAGE_HISTORY`). Each agent answer and each "compare answers" row is billed too (docs/technical-guide.md, "Value chat"). The running app has an idle cost; `docs/operating-cost.md` shows how to suspend it.

## Step 1: get the code and configure

```bash
git clone https://github.com/sfc-gh-jkang/agentic-parse-demo-public.git agentic-parse-demo
cd agentic-parse-demo
cp config.env.example config.env
```

Edit `config.env`: set `SNOWFLAKE_CONNECTION` to your connection name. Keep the default names, or change `DEMO_DATABASE`, `DEMO_SCHEMA`, `DEMO_ROLE`, `DEMO_WAREHOUSE` and `APP_NAME` to install a second copy side by side. Check the connection:

```bash
snow connection test -c <your-connection>
```

## Step 2: install

```bash
./setup.sh
```

It runs, in order: preflight (CLI, Node, uv, connection, ACCOUNTADMIN, cross-region setting, the docs database), the role and objects, a probe of every pinned model, the corpus upload, then **stops to show the parse cost and ask y/N**, parses the corpus, scores it, creates the search services and agents, loads the design docs, deploys the app and prints its URL. About 10 to 15 minutes, most of it the app build. Use `./setup.sh --yes` to skip the prompt, `--skip-parse` to install without parsing. Re-running is safe and does not re-bill parsed documents.

## Step 3: open the app

Open the printed URL and sign in with your Snowflake user; your user needs the demo role (setup grants it to the installing user). Share with others: `GRANT ROLE AGENTIC_PARSE_DEMO_RL TO USER <name>` (see `docs/sharing.md`).

## Try it

From `docs/talk-track.md`:

1. **Documents list:** 11 documents, each stressing one capability, plus a text-only control document where LAYOUT is enough. Note the measured cost strip.
2. **Open `quarterly_report`:** amber boxes are the visuals AGENTIC found. Click the revenue chart: its series appear as a table next to the ground truth. Switch the mode picker to LAYOUT and OCR and compare.
3. **Compare modes, AGENTIC vs LAYOUT:** read the score strip (relations: a value with its label, edge or row; facts inside images). Then AGENTIC vs OCR: OCR reads most characters but loses which number belongs to which label.
4. **Upload** a one-page PDF with only AGENTIC checked (about 0.008 AI credits on the author's account).
5. **Ask the agent:** "In quarterly_report, what was Q3 revenue on the revenue chart?" The table under the answer asks the same question of each mode's parse: on the author's account only AGENTIC's parse contained the answer. Then "give me a tour of this screen".

AGENTIC is not perfect: on this corpus it detected and typed 15 of 28 visuals (`docs/stage2-report.md`); the app shows its misses.

## Pre-flight a customer document

Before showing a customer their own file, check whether AGENTIC adds something on it (billed: the file is parsed in all three modes):

```bash
uv run python scripts/preflight.py path/to/file.pdf
```

The report lists where AGENTIC wins or ties, with measured credits. Example: `docs/preflight-example.md`.

## Clean up

```bash
./teardown.sh
```

Asks you to type the schema name, then drops the app, the schema and everything in it, the warehouse, the role and the Snowflake Intelligence listing, and prints `SHOW` results that should all be empty. The database is dropped only if it is not `SNOWFLAKE_EXAMPLE` and holds no other schemas.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Preflight: cannot use ACCOUNTADMIN | An admin runs `.build/sql/01_setup.sql` (after `python3 scripts/demo_config.py render`), then set `SKIP_ADMIN=1` |
| Preflight: SNOWFLAKE_DOCUMENTATION not found | Only a warning: setup continues without the docs tool (`DOCS_SEARCH=0`). To add it, install the knowledge extension (Prerequisites), set `DOCS_SEARCH=auto`, re-run `./setup.sh`. Fails only if you set `DOCS_SEARCH=1` |
| Headless test: 401/redirect with a PAT | The PAT user must be subject to a network policy and the PAT role must be able to use the app (see runbook "Auth for headless tests") |
| A model probe fails | Enable cross-region inference, or change the pin in `sql/templates/agent_spec.yaml.tmpl` and `web/lib/ask.ts` |
| AGENTIC parse returns errors | It is Public Preview; check region availability on the AI_PARSE_DOCUMENT page |
| `snow app deploy` fails | Upgrade the Snowflake CLI; https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/getting-started |
| App URL not ready | Wait a few minutes; `SHOW APPLICATION SERVICES IN SCHEMA <db>.<schema>` shows the status and `url` |

More: `docs/runbook.md`, and the Cortex Code skill in `cortex-skill/agentic-parse-demo` (copy it to `~/.snowflake/cortex/skills/` to use it anywhere, or open Cortex Code in this repo, where `.cortex/skills/` loads it; skill locations: https://docs.snowflake.com/en/user-guide/cortex-code/extensibility).

## What you learned

- How the three AI_PARSE_DOCUMENT modes differ on visual documents, measured against ground truth.
- What AGENTIC costs per page next to LAYOUT and OCR on the same pages.
- How to store every parse run and serve an app and an agent from storage, so a demo spends credits only when you ask it to.

## Links

- AI_PARSE_DOCUMENT: https://docs.snowflake.com/en/sql-reference/functions/ai_parse_document
- AGENTIC mode release note: https://docs.snowflake.com/en/release-notes/2026/other/2026-10-28-ai-parse-document-agentic-mode-preview
- Cortex AI pricing: https://docs.snowflake.com/en/user-guide/snowflake-cortex/pricing
- Snowflake App Runtime getting started: https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/getting-started
- CREATE AGENT: https://docs.snowflake.com/en/sql-reference/sql/create-agent
- Cross-region inference: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cross-region-inference
