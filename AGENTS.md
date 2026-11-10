# AGENTS.md

Guidance for coding agents working in this repository. Vocabulary: [GLOSSARY.md](GLOSSARY.md). Design: [docs/SPEC.md](docs/SPEC.md).

## Commands

```bash
cp config.env.example config.env        # SNOWFLAKE_CONNECTION, DEMO_* names; key-pair or PAT auth
./setup.sh                              # preflight, objects, billed Corpus parse (asks first), app deploy
./teardown.sh                           # removes everything setup.sh created
uv run pytest -q                        # non-live tests (live tests skip without LIVE=1)
LIVE=1 uv run pytest -q                 # live against the configured connection; bills a few pages
cd web && npx vitest run && npx tsc --noEmit && npm run build
uv run python scripts/gen_agents_sql.py # regenerate sql/09b_agents.sql from sql/templates
uv run python scripts/check_models.py   # verify pinned agent models
```

## Architecture

- `generator/` builds the synthetic Corpus (`corpus/*.pdf|png|jpg`) and Ground Truth (`*.truth.json`) deterministically.
- `sql/01..09b` create the role, warehouse, stage, parse procedures (AI_PARSE_DOCUMENT in OCR, LAYOUT and AGENTIC modes), stored Parse Runs, cost views, upload pipeline, Cortex Search service, semantic view for Cortex Analyst, agent tools and the Cortex Agents.
- `scoring/` scores each mode's output against Ground Truth; `scripts/parse_corpus.py` runs the billed parse once and persists every run (see `docs/adr/0001-persist-every-parse-run.md`).
- `web/` is the Next.js app deployed to Snowflake App Runtime (`snow app deploy`); `web/AGENTS.md` covers App Runtime commands. The on-screen Demo Agent drives the app through client tools.
- `snowsight/` is the no-local-tools install path; `cortex-skill/` is the Cortex Code skill.

## Rules

- Never commit `config.env`, keys or tokens. Account-specific values come from `config.env` or the environment.
- Billed parses are explicit: `setup.sh` asks before parsing; tests document their page counts.
- Every documentation link must point to public `docs.snowflake.com` pages.
