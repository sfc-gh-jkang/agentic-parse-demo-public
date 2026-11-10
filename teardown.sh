#!/usr/bin/env bash
# Remove everything ./setup.sh created: app, Snowflake Intelligence listing, schema, warehouse, role.
#   ./teardown.sh [--yes]
# The database is dropped only if it is not SNOWFLAKE_EXAMPLE and holds no other schemas.
# Runs as ACCOUNTADMIN on SNOWFLAKE_CONNECTION. After a SKIP_ADMIN=1 install, point it at an admin
# connection: SNOWFLAKE_CONNECTION=<admin-connection> ./teardown.sh
set -euo pipefail
cd "$(dirname "$0")"
# Without config.env every name falls back to config.env.example: the shipped defaults, i.e. the main deployment.
[ -f config.env ] || { echo "No config.env here, so the names would be the defaults from config.env.example. Refusing." >&2; exit 1; }
cfg() { python3 scripts/demo_config.py get "$1"; }
CONN=$(cfg SNOWFLAKE_CONNECTION); ROLE=$(cfg DEMO_ROLE); WH=$(cfg DEMO_WAREHOUSE)
DB=$(cfg DEMO_DATABASE); SCH=$(cfg DEMO_SCHEMA); S="$DB.$SCH"; APP=$(cfg APP_NAME)
echo "This drops: application service $S.$APP, schema $S (all tables, stages, agents, search services),"
echo "warehouse $WH, role $ROLE, and the SI listing of $S.AGENTIC_PARSE_DEMO_SI_AGENT. It cannot be undone."
echo "Dropping the app service also retires its URL: if you run ./setup.sh again the app gets a NEW URL, so shared links stop working."
DEFAULT_NAMES=$(python3 scripts/demo_config.py defaults-match 2>/dev/null || echo no)
if [ "${1:-}" = --yes ] && [ "$DEFAULT_NAMES" = yes ] && [ "${TEARDOWN_DEFAULT_NAMES:-}" != 1 ]; then
  echo "--yes against the default names ($S) needs TEARDOWN_DEFAULT_NAMES=1 as well. Refusing." >&2; exit 1
fi
if [ "${1:-}" != --yes ]; then read -r -p "Type the schema name ($SCH) to confirm: " ans; [ "$ans" = "$SCH" ] || { echo "Cancelled."; exit 1; }; fi

q() { snow sql -c "$CONN" --role ACCOUNTADMIN -q "$1"; }
q "DROP APPLICATION SERVICE IF EXISTS $S.$APP" >/dev/null || true
q "EXECUTE IMMEDIATE \$\$ BEGIN ALTER SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT DROP AGENT $S.AGENTIC_PARSE_DEMO_SI_AGENT; EXCEPTION WHEN OTHER THEN NULL; END; \$\$" >/dev/null || true
q "DROP SCHEMA IF EXISTS $S CASCADE" >/dev/null
q "DROP WAREHOUSE IF EXISTS $WH" >/dev/null
q "DROP ROLE IF EXISTS $ROLE" >/dev/null
if [ "$DB" != SNOWFLAKE_EXAMPLE ]; then
  N=$(snow sql -c "$CONN" --role ACCOUNTADMIN --format json -q "SHOW SCHEMAS IN DATABASE $DB" 2>/dev/null \
    | python3 -c "import json,sys; print(sum(r['name'] not in ('INFORMATION_SCHEMA','PUBLIC') for r in json.load(sys.stdin)))" || echo 1)
  [ "$N" = 0 ] && q "DROP DATABASE IF EXISTS $DB" >/dev/null && echo "dropped database $DB"
fi

echo "Verify (each should be empty):"
q "SHOW SCHEMAS LIKE '$SCH' IN DATABASE $DB"
q "SHOW WAREHOUSES LIKE '$WH'"
q "SHOW ROLES LIKE '$ROLE'"
q "SHOW APPLICATION SERVICES LIKE '$APP' IN ACCOUNT"
echo "Not dropped: snow app deploy leaves finished build-job services (SPCS_APP_BUILDER_JOB_*) in your"
echo "personal database USER\$<you>.PUBLIC; they hold no data. List: SHOW SERVICES LIKE 'SPCS_APP_BUILDER_JOB_%' IN SCHEMA USER\$<you>.PUBLIC"
