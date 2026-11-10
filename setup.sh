#!/usr/bin/env bash
# One-command install of the Agentic Parse Demo. Idempotent: re-run any time; nothing billed twice.
#   ./setup.sh [--yes] [--skip-parse]
# Config: config.env (copy config.env.example). Needs: snow CLI, node 20+, uv, a key-pair or PAT connection.
set -euo pipefail
cd "$(dirname "$0")"
YES=0; SKIP_PARSE=0
for a in "$@"; do case "$a" in
  --yes|-y) YES=1 ;; --skip-parse) SKIP_PARSE=1 ;;
  -h|--help) sed -n 2,4p "$0"; exit 0 ;; *) echo "unknown option $a"; exit 2 ;; esac; done
[ -f config.env ] || { cp config.env.example config.env; echo "Created config.env from config.env.example; set SNOWFLAKE_CONNECTION, then re-run."; exit 1; }

cfg() { python3 scripts/demo_config.py get "$1"; }
CONN=$(cfg SNOWFLAKE_CONNECTION); ROLE=$(cfg DEMO_ROLE); WH=$(cfg DEMO_WAREHOUSE)
S=$(cfg FQ_SCHEMA); APP=$(cfg APP_NAME); SKIP_ADMIN=$(cfg SKIP_ADMIN)
# PACK=insurance|manufacturing|finance installs an industry pack instead of the neutral Corpus (README).
PACK="${PACK:-neutral}"; CORPUS_DIR=corpus
if [ "$PACK" != neutral ]; then
  CORPUS_DIR="corpus_packs/$PACK"
  [ -f "$CORPUS_DIR/manifest.json" ] || uv run python -m generator.corpus --pack "$PACK"
fi
step() { printf '\n== %s\n' "$*"; }
sqlf() { snow sql -c "$CONN" -f ".build/sql/$1" >/dev/null; echo "ok  $1"; }
sqlq() { snow sql -c "$CONN" --role "$ROLE" --warehouse "$WH" -q "$1" >/dev/null; }

step "Preflight"
need() { command -v "$1" >/dev/null || { echo "FAIL $1 not found. $2"; exit 1; }; }
need snow "Install the Snowflake CLI: https://docs.snowflake.com/en/developer-guide/snowflake-cli/installation/installation"
need node "Install Node.js 20 or later."
need uv "Install uv: https://docs.astral.sh/uv/"
SNOWV=$(snow --version | awk '{print $NF}'); echo "snow CLI $SNOWV (tested with 3.31.0; snow app deploy needs a recent CLI)"
[ "$(printf '%s\n3.31.0\n' "$SNOWV" | sort -V | head -1)" = 3.31.0 ] || echo "WARN snow CLI older than 3.31.0; upgrade if snow app deploy fails"
NODEV=$(node -v | tr -d v | cut -d. -f1); [ "$NODEV" -ge 20 ] || { echo "FAIL node $NODEV < 20"; exit 1; }
snow connection test -c "$CONN" >/dev/null || { echo "FAIL connection $CONN does not work (snow connection test -c $CONN)"; exit 1; }
uv sync -q
uv run python scripts/setup_checks.py account
echo "Installing into $S (role $ROLE, warehouse $WH, app $APP) via connection $CONN"
python3 scripts/demo_config.py render >/dev/null

step "Objects"
if [ "$SKIP_ADMIN" = 1 ]; then echo "SKIP_ADMIN=1: assuming an admin ran .build/sql/01_setup.sql"; else sqlf 01_setup.sql; fi
uv run python scripts/setup_checks.py models
sqlf 02_parse_core.sql
snow sql -c "$CONN" --role "$ROLE" -q "PUT 'file://$PWD/$CORPUS_DIR/*' @$S.DOCS/corpus/ AUTO_COMPRESS=FALSE OVERWRITE=TRUE; ALTER STAGE $S.DOCS REFRESH;" >/dev/null; echo "ok  corpus upload"
sqlf 03_register_corpus.sql
snow sql -c "$CONN" --role "$ROLE" -q "PUT 'file://$PWD/.build/scoring/score.py' @$S.CODE AUTO_COMPRESS=FALSE OVERWRITE=TRUE; PUT 'file://$PWD/.build/scoring/compare_proc.py' @$S.CODE AUTO_COMPRESS=FALSE OVERWRITE=TRUE;" >/dev/null; echo "ok  scoring code"
for f in 04_compare_modes.sql 05_parse_cost.sql 06_app_support.sql 07_upload.sql 07b_value_and_data.sql; do sqlf "$f"; done
sqlq "CALL $S.MATERIALIZE_DOCUMENT_FILES()"; echo "ok  document files"

step "Parse the Corpus (billed)"
if [ "$SKIP_PARSE" = 1 ]; then echo "skipped (--skip-parse); the app shows no comparisons until you run it"
else
  uv run python scripts/setup_checks.py cost "$CORPUS_DIR"
  echo "Only Document/mode pairs without a stored run are parsed; a re-run after a full parse costs nothing."
  if [ "$YES" != 1 ]; then read -r -p "Parse now? [y/N] " ans; [[ "$ans" =~ ^[Yy] ]] || { echo "Stopped before the billed step. Re-run with --yes, or --skip-parse."; exit 1; }; fi
  uv run python scripts/parse_corpus.py --missing
fi
# REFRESH only rescores Documents with a newer Parse Run, so clear first: a new score.py must reach every row.
sqlq "DELETE FROM $S.MODE_COMPARISONS; CALL $S.REFRESH_MODE_COMPARISONS(NULL)"; echo "ok  comparisons"

step "Search and agents"
sqlf 08_search_agent.sql
sqlf 09_agent_tools.sql
sqlf 09b_agents.sql
uv run python scripts/load_design_docs.py
sqlq "ALTER CORTEX SEARCH SERVICE $S.DESIGN_DOCS_SEARCH REFRESH; ALTER CORTEX SEARCH SERVICE $S.PARSED_DOCS_SEARCH REFRESH;"; echo "ok  search refresh"

step "App"
(cd .build/web && snow app deploy --connection "$CONN" --role "$ROLE" --warehouse "$WH")
URL=$(snow sql -c "$CONN" --role "$ROLE" --format json -q "SHOW APPLICATION SERVICES LIKE '$APP' IN SCHEMA $S" \
  | python3 -c "import json,sys; r=json.load(sys.stdin); u = r[0].get('url', '') if r else ''; print(('https://' + u) if u and not u.startswith('http') else u)")

step "Done"
echo "App URL: ${URL:-not ready yet; run: snow sql -c $CONN --role $ROLE -q \"SHOW APPLICATION SERVICES IN SCHEMA $S\"}"
cat <<NEXT
Next:
  - Open the URL and sign in with your Snowflake user (role $ROLE).
  - Talk track: docs/talk-track.md. Pre-flight a customer file: uv run python scripts/preflight.py FILE
  - Model check any time: uv run python scripts/check_models.py
  - Remove everything: ./teardown.sh
NEXT
