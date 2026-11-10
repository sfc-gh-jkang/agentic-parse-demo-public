#!/usr/bin/env bash
# Refresh every Snowflake object and the app without the billed Corpus parse. Kept for existing runbooks;
# ./setup.sh is the entry point (it adds preflight checks and the parse step). PACK=... is passed through.
exec "$(dirname "$0")/../setup.sh" --skip-parse "$@"
