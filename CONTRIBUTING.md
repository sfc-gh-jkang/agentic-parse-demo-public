# Contributing

This is a reference demo, maintained by its owner on a best-effort basis. Issues and pull requests are welcome.

## Before you open a pull request

1. Run the non-live checks: `uv run pytest -q` and `cd web && npm ci && npx vitest run && npx tsc --noEmit && npm run build`.
2. If you changed SQL, the agent spec or the parse pipeline, run the live suite against your own account into a scratch schema (set `DEMO_SCHEMA` in `config.env`): `LIVE=1 uv run pytest -q`. It bills a few pages (see the README "Tests" section).
3. Keep vocabulary consistent with [GLOSSARY.md](GLOSSARY.md).
4. Never commit `config.env`, keys (`*.p8`, `*.pem`), tokens or account-specific hosts. `tests/test_packaging.py` checks for home paths, account locators and account URLs; set `APD_BANNED` to add your own terms.

## Reporting bugs and ideas

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For security issues, see [SECURITY.md](SECURITY.md) and do not open a public issue.
