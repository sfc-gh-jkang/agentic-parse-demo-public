# Runbook

Pre-demo checklist for the Agentic Parse Demo. Snippets use `<your-connection>` and the default names; substitute yours from `config.env` (`python3 scripts/demo_config.py get SNOWFLAKE_CONNECTION`). Role `AGENTIC_PARSE_DEMO_RL`, warehouse `SFE_AGENTIC_PARSE_DEMO_WH`, schema `SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO`. Every snippet here was executed on 2026-10-30 unless marked otherwise (docs/audits.md).

## 1. Service is RUNNING (T-30 min)

```bash
snow sql -c <your-connection> --role AGENTIC_PARSE_DEMO_RL -q "SHOW APPLICATION SERVICES IN SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO"
```

`status` must be `RUNNING`; `url` is the app address. Snowflake App Runtime: https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/about-snowflake-app-runtime

Both search services should be `ACTIVE` for indexing and serving:

```bash
snow sql -c <your-connection> --role AGENTIC_PARSE_DEMO_RL -q "SHOW CORTEX SEARCH SERVICES IN SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO"
```

## 1b. Pinned models still answer (T-30 min)

```bash
uv run python scripts/check_models.py
```

Probes every pinned model with the call it really makes: `DATA_AGENT_RUN` on both agents (and checks the live spec still pins the model) and `AI_COMPLETE` for the Compare answers model. Exits non-zero if any fails. It also lists newer versions in the same family that answer (report only; pins are never changed). Executed 2026-11-01: all three OK on `claude-sonnet-5-5`, no newer Sonnet available.

## Auth for headless tests (key pair or PAT)

The deployed app's ingress takes `Authorization: Snowflake Token="<token>"`. Two ways to get the token:

- **PAT:** `export SNOWFLAKE_PAT=<programmatic access token>` in the shell that runs the scripts. A PAT is sent as is; no exchange (https://docs.snowflake.com/en/developer-guide/snowpark-container-services/tutorials/advanced/tutorial-8-access-public-endpoint-programmatically). `web/e2e/*` and `scripts/record_walkthrough.mjs` read it from the environment; `scripts/app_token.py` prints nothing in this mode, so skip it and the `/tmp/.app_tok` file and `rm` lines below. Never put the PAT in `config.env` or a file. The PAT user needs a network policy that allows your IP and a role that can use the app's service role (https://docs.snowflake.com/en/user-guide/programmatic-access-tokens).
- **Key pair:** `SNOWFLAKE_PRIVATE_KEY_PATH=... uv run python scripts/app_token.py > /tmp/.app_tok`, as in the commands below.

If both are present `SNOWFLAKE_PAT` wins. `setup.sh`, `teardown.sh` and the other scripts use `snow -c <connection>` or the Python connector and so work with any auth that connection supports.

## 2. Warm the caches (T-15 min)

Open the app once in Chrome (Snowflake sign-in) and click through every Document, or headless:

```bash
SNOWFLAKE_PRIVATE_KEY_PATH=~/.snowflake/keys/<your_key>.p8 uv run python scripts/app_token.py > /tmp/.app_tok
APP=https://$(python3 scripts/demo_config.py get APP_HOST)   # APP_HOST in config.env
H="Authorization: Snowflake Token=\"$(cat /tmp/.app_tok)\""
for d in $(curl -s -H "$H" $APP/api/documents | python3 -c "import json,sys;print(' '.join(x['docId'] for x in json.load(sys.stdin)['documents']))"); do
  for p in file runs visuals comparison; do curl -s -o /dev/null -w "$d $p %{http_code} %{time_total}s\n" -H "$H" "$APP/api/documents/$d/$p"; done
done
rm /tmp/.app_tok
```

Every line should be `200`. Then ask the agent one warm-up question in the chat (for example the invoice number question) so the first live answer on stage is not the cold one.

## 3. Cost of a live run

Measured on this account (`CALL SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.PARSE_COST(NULL)`, 2026-10-30, re-measured 2026-11-01 over 38/30/42 billed pages with no pending runs: unchanged): AGENTIC 8.18, LAYOUT 3.66, OCR 0.68 AI credits per 1,000 pages. One live 1-page AGENTIC parse is therefore about 0.008 AI credits; the 35 AGENTIC pages billed so far (Corpus, tests and one upload) cost 0.29 AI credits in total. Warehouse credits are extra. Pricing: https://docs.snowflake.com/en/user-guide/snowflake-cortex/pricing

## 3b. Storyline order and the flow check

The talk track runs: Opening payoff, Value beat (value panel, cost per correct fact, volume, cost including review with the audience's own assumptions), Beat 1 (chart + score strip), Beat 2 (multi-step goal with How I answered), Beat 3 (trap, What was missed, control Document), Beat 4 (reparse, cost stated, yes), Beat 5 (eval results, cuttable), Data beat (every chart value is a row, the Use this data tab), Close (upload). Rehearse it end to end against any agent without touching the live one:

```bash
uv run python scripts/temp_agent.py create                      # temp copy of the agent from sql/09b_agents.sql
(cd web && DEMO_AGENT_NAME=AGENTIC_PARSE_DEMO_AGENT_T21_FLOW SNOWFLAKE_CONNECTION_NAME=<your-connection> npm run dev)   # local app, that agent
(cd web && AGENT_NAME=AGENTIC_PARSE_DEMO_AGENT_T21_FLOW node e2e/storyline.e2e.mjs)   # whole talk track, screenshots in /tmp/t21-flow
uv run python scripts/temp_agent.py drop                        # always drop it
```

With non-default names in `config.env`, start the local app from `.build/web` instead of `web` (`python3 scripts/demo_config.py render`, then `npm ci` there): `web/` holds the default names, so its API routes query the default schema.

`storyline.e2e.mjs` asserts every beat by what is visible in the viewport (not covered, not clipped) and the chat URL at the reparse prompt; it declines the billed reparse unless `CONFIRM_REPARSE=1`, and never uploads. Never run `npm run build` while `next dev` is running.

Onboarding and chat history (no agent needed): `(cd web && OUT_DIR=/tmp/t21-tour node e2e/onboarding.e2e.mjs)` checks the first-visit welcome, every one of the 10 tour steps (card, ring and target in the viewport), New chat, and that Reset demo clears the chat; its Reset step calls `/api/reset`, which removes uploads only. With `WITH_AGENT=1 AGENT_NAME=<temp agent>` it also asks the agent for a tour. Chat history lives in `sessionStorage` (`agentic-parse-demo:chat`), per browser tab; the first-visit flag is in `localStorage` (`agentic-parse-demo:welcomed`) and Reset demo leaves it alone.

The agent starts the tour with the `control_app` action `start_tour`. Until `sql/09_agent_tools.sql` and `sql/09b_agents.sql` are deployed, the live agent does not know that action. To test an undeployed tool change, create a scratch copy and point temp agents at it, then drop both:

```bash
uv run python scripts/scratch_control_app.py create             # CONTROL_APP_T21, from sql/09_agent_tools.sql; live CONTROL_APP untouched
CONTROL_APP_NAME=CONTROL_APP_T21 uv run python scripts/temp_agent.py create
CONTROL_APP_NAME=CONTROL_APP_T21 EVAL_AGENT_SUFFIX=_T21 uv run python scripts/eval_agent.py --models claude-sonnet-5-5 --only app_start_tour
uv run python scripts/temp_agent.py drop && uv run python scripts/scratch_control_app.py drop
```

## 4. Reset the demo (before or after an audience)

On the home page, **Reset demo** (top right) asks for confirmation, then deletes every Uploaded Document and its Parse Runs, clears the chat, closes any tour or highlight and switches to the light theme. The Corpus and its stored results stay. It calls `RESET_DEMO()` (sql/07_upload.sql, owner's rights: deletes the upload rows in `DOCUMENTS`, `DOCUMENT_FILES`, `PARSE_RUNS`, `MODE_COMPARISONS` and refreshes `PARSED_DOCS_SEARCH`), then removes the files: REMOVE is rejected inside a stored procedure ("Unsupported statement", tested 2026-11-01), so `web/app/api/reset/route.ts` runs it as a separate statement. The Demo Agent has no tool for this. Note: `up_memo_5f62b0` (T13's test upload) is an upload too and is removed by a reset.

To see what a reset would remove, and the same reset from a terminal (both executed 2026-11-01, `tests/test_reset_demo.py`):

```bash
snow sql -c <your-connection> --role AGENTIC_PARSE_DEMO_RL --warehouse SFE_AGENTIC_PARSE_DEMO_WH -q "SELECT DOC_ID, STAGE_PATH, ADDED_AT FROM SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCUMENTS WHERE SOURCE = 'upload'"
snow sql -c <your-connection> --role AGENTIC_PARSE_DEMO_RL --warehouse SFE_AGENTIC_PARSE_DEMO_WH -q "
CALL SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.RESET_DEMO();
REMOVE @SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCS/uploads/;
ALTER STAGE SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCS REFRESH;"
```

A confirmed reparse in Beat 4 stores one more Parse Run (a Live Result) for `receipt_photo`, a Corpus Document, so Reset does not remove it; it is cheap (about 0.008 AI credits) and the stored run stays visible as the latest AGENTIC run.

Deleting upload Parse Runs also removes their credits from the measured-cost figures, which only cover stored runs.

## 4b. Pre-flight a customer's document (the day before)

```bash
uv run python scripts/preflight.py ~/Downloads/their_doc.pdf --out /tmp/preflight.md
```

Uploads it through the same checks as the app (doc id `up_pf_...`), parses it in all three modes (**billed**: pages x 3 modes), asks four generic questions of each mode's text alone (table? number only inside an image? checkbox? headline total?) with the Compare answers prompt, prints measured credits once usage telemetry reports (it can lag minutes; "pending" is never an estimate), writes a markdown report and deletes the upload (`--keep` to leave it for the demo). If AGENTIC wins nothing, use a Corpus Document instead. Example: [preflight-example.md](preflight-example.md).

## 5. Fallback if a live parse is slow

A cold live AGENTIC parse has been observed at 189 s; the e2e run on 2026-10-30 parsed a 1-page upload in about 33 s end to end. If a live parse is still running after about 30 s:

1. Keep talking: the progress row shows elapsed seconds, and nothing on screen is blocked.
2. Switch to a Corpus Document. Every Corpus Document is already parsed in all three modes; results are labelled **Cached Result** with their age. Say so: "this ran earlier today; same function, stored result".
3. Come back to the upload at the end; it opens in the viewer when it finishes.

Snowflake Intelligence lists only `AGENTIC_PARSE_DEMO_SI_AGENT` (no screen control); demo screen control in the web app, which calls `AGENTIC_PARSE_DEMO_AGENT`. Check: `SHOW AGENTS IN SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT`. Redeploy agents with `python3 scripts/gen_agents_sql.py` then `snow sql -f sql/09b_agents.sql`.

If the agent is slow or errors, the same Cached Results are in the viewer; the talk track does not depend on the agent for any number.

Asking about a fresh upload right away is fine: `APP_PARSE` refreshes `PARSED_DOCS_SEARCH` before it returns, and `SEARCH_PREVIEW` returned the upload within 1 s of that in 3 of 3 trials (2026-11-01; APP_PARSE 17 to 27 s, then the agent's cited answer 10.9 / 13.3 / 12.7 s). The smoke test's upload chat step normally takes 15 to 19 s; when it shows about 48 s, the first answer missed the expected total or citation and the test waited 30 s and asked again (it now prints why).

## 5b. If the live demo fails

Play the recorded walkthrough: `docs/walkthrough/agentic-parse-demo-walkthrough.mp4` (2.5 min, 1440x900, silent with on-screen captions: home and cost, the Q3 revenue question answered across modes, the score strip and the chart Visual against Ground Truth, a multi-step agent answer that moves the app, the value panel with review cost, Use this data, a tour). `docs/walkthrough/agentic-parse-demo-agent.gif` is the agent segment as a short loop. Stills of the same screens are in `docs/screenshots/`. To record a fresh talk-track video after an app change (no billed parse, one agent answer and one tour; writes `docs/walkthrough/walkthrough.webm` plus numbered stills):

```bash
SNOWFLAKE_PRIVATE_KEY_PATH=~/.snowflake/keys/<your_key>.p8 uv run python scripts/app_token.py > /tmp/.app_tok
APP_TOKEN_FILE=/tmp/.app_tok node scripts/record_walkthrough.mjs; rm /tmp/.app_tok
```

Say plainly it is a recording of the same app from today; every number in it comes from the same stored runs.

## 6. Smoke test (optional, spends about 0.008 AI credits)

```bash
SNOWFLAKE_PRIVATE_KEY_PATH=~/.snowflake/keys/<your_key>.p8 uv run python scripts/app_token.py > /tmp/.app_tok
(cd web && APP_TOKEN_FILE=/tmp/.app_tok node e2e/demo.e2e.mjs); rm /tmp/.app_tok
```

Prints `PASS` and leaves no upload behind.
