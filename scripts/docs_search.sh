#!/usr/bin/env bash
# Snowflake docs lookup via the CKE docs Cortex Search service on the configured account
# (same index the agent's snowflake_docs tool uses). Usage: scripts/docs_search.sh "query" [limit]
cd "$(dirname "$0")/.."
if [ "$(python3 scripts/demo_config.py get DOCS_SEARCH)" = 0 ]; then
  echo "Snowflake docs search is off (DOCS_SEARCH=0: no SNOWFLAKE_DOCUMENTATION database on this account)." >&2
  echo "Get the free 'Cortex Knowledge Extension: Snowflake Documentation' from Snowflake Marketplace (database name SNOWFLAKE_DOCUMENTATION), then set DOCS_SEARCH=auto in config.env." >&2
  echo "Steps: https://www.snowflake.com/en/developers/guides/get-started-snowflake-cortex-knowledge-extensions/" >&2
  echo "Or point at an account that has it: SNOWFLAKE_CONNECTION=<conn> DOCS_SEARCH=1 $0 \"query\"" >&2
  exit 1
fi
q=$(printf '%s' "$1" | sed "s/'/''/g; s/\"/\\\\\"/g")
c() { python3 scripts/demo_config.py get "$1"; }
snow sql -c "$(c SNOWFLAKE_CONNECTION)" --role "$(c DEMO_ROLE)" --warehouse "$(c DEMO_WAREHOUSE)" --format json -q "SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW('SNOWFLAKE_DOCUMENTATION.SHARED.CKE_SNOWFLAKE_DOCS_SERVICE', '{\"query\": \"$q\", \"columns\": [\"DOCUMENT_TITLE\",\"SOURCE_URL\",\"CHUNK\"], \"limit\": ${2:-5}}') AS R" \
 | python3 -c "import json,sys; r=json.loads(json.load(sys.stdin)[0]['R']); [print(x['SOURCE_URL'],'|',x['DOCUMENT_TITLE'],'|',x['CHUNK'][:400].replace(chr(10),' ')) for x in r['results']]"
