---
name: agentic-parse-demo
description: "Install, run, reset, troubleshoot or remove the Agentic Parse Demo (AI_PARSE_DOCUMENT OCR vs LAYOUT vs AGENTIC, Snowflake App Runtime app, Cortex Agent). Use when the user says: install the agentic parse demo, set up the parse demo, preflight a customer document, will AGENTIC work on this file, reset the demo, run the talk track, demo script, teardown or uninstall the parse demo, the parse demo app is broken."
---

# Agentic Parse Demo

Operates the repo `agentic-parse-demo` (clone it first if it is not the working directory:
`git clone https://github.com/sfc-gh-jkang/agentic-parse-demo-public.git agentic-parse-demo`). All names come from `config.env`
(copy of `config.env.example`); read it before any step and use its connection, role, warehouse and schema.
Never hard-code `SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO`: print `python3 scripts/demo_config.py get FQ_SCHEMA`.

## Intent

| Intent | Triggers | Go to |
|---|---|---|
| INSTALL | install, set up, deploy the demo | Install |
| PREFLIGHT | preflight a customer document, will AGENTIC help on this PDF | Preflight a document |
| RESET | reset the demo, clear uploads before a meeting | Reset |
| TALK | run the talk track, demo script, what do I show | Talk track |
| TROUBLESHOOT | app down, agent errors, model not available, deploy failed | `references/troubleshooting.md` |
| TEARDOWN | remove, uninstall, teardown, clean up | Teardown |

## Install

1. If `config.env` is missing: `cp config.env.example config.env`, then ask the user for
   `SNOWFLAKE_CONNECTION` (key-pair or PAT auth; check with `snow connection test -c <name>`) and
   whether to keep the default names. Write their answers into `config.env`.
2. Run the preflight-only part first so the user sees blockers before anything is created:
   `uv sync -q && uv run python scripts/setup_checks.py account`.
   FAIL lines are blockers (no ACCOUNTADMIN): stop and show the fix. A missing `SNOWFLAKE_DOCUMENTATION` database is only a WARN under `DOCS_SEARCH=auto` (default): setup sets `0` and continues without the docs tool; `1` makes it mandatory. Show the WARN text.
3. **Stopping point (billed):** show the parse cost with `uv run python scripts/setup_checks.py cost`
   and ask "Parse the Corpus now (about 0.28 AI credits)?". Do not pass `--yes` without a yes.
4. Run `./setup.sh --yes` (or `./setup.sh --skip-parse` if they declined). Long-running: about 10 to
   15 minutes, most of it the app build. Re-runs are idempotent and never re-bill parsed pairs.
5. Headless app tests (`web/e2e/*`) with a PAT: `export SNOWFLAKE_PAT=<token>` in the shell only, never in `config.env` or a file; a PAT wins over key-pair (`docs/runbook.md`).
6. Report the App URL printed at the end and point at `docs/QUICKSTART.md` "Try it".

No local tools? Point to `docs/install-snowsight.md` (SQL-only, then the app needs the Snowflake CLI).

## Preflight a document

1. **Stopping point (billed):** `scripts/preflight.py` parses the file in all three modes. Tell the user the
   page count (`uv run python -c "from pypdf import PdfReader; print(len(PdfReader('FILE').pages))"`) and
   ask before running.
2. `uv run python scripts/preflight.py FILE [FILE ...]` (add `--keep` to leave it in the app as an upload).
3. Summarize the written report: where AGENTIC wins or ties, and the measured credits. Example output:
   `docs/preflight-example.md`.

## Reset

Deletes every Uploaded Document and clears chat; the Corpus and its stored runs stay. Not billed.
**Stopping point (destructive):** confirm, then either the app's **Reset demo** button, or:
`snow sql -c <conn> --role <role> --warehouse <wh> -q "CALL <FQ_SCHEMA>.RESET_DEMO()"`.

## Talk track

Read `docs/talk-track.md` and walk the user through it; `docs/runbook.md` is the pre-meeting checklist (run its
health checks first). Beats and details: `references/storyline.md`. In order: payoff, value, multi-step goal
(with **How I answered**), limits, re-parse confirm, evals, data product, close. Only Upload, the Run buttons
on billed snippets, re-parse and the value chat spend AI credits; say so before the user clicks one.
**Stopping point (billed):** never confirm a re-parse or upload for the user; the agent asks yes/no first.

New to the app? Use **Take the tour** (header) or ask the agent "give me a tour": 12 steps, no agent call, nothing billed.

## Teardown

**Stopping point (destructive, cannot be undone):** list what `./teardown.sh` drops (app, schema, warehouse,
role, SI listing; the database only if it is not `SNOWFLAKE_EXAMPLE` and is empty) and get an explicit yes.
Interactive runs make the user type the schema name. `--yes` against the default names is refused unless
`TEARDOWN_DEFAULT_NAMES=1` is also set; do not set it without the user saying so. Then show its SHOW output
(every result empty). Snowsight installs also have the git clone: `references/troubleshooting.md`.

Never drop the app service to redeploy: `snow app deploy` updates in place. Recreating the app service
changes the App URL (a re-install after teardown gets a new one), so re-share the link.

## Output

Commands run, their result, the app URL or the verification output. Never print secrets or tokens. Tested cold-start installs: AWS US East 1 and US West 2 (`TESTING.md`).
