# Install from Snowsight (no local tools)

For accounts where you can run SQL in Snowsight but cannot install the Snowflake CLI, Node.js or uv. Installs with the **default names** only (`SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO`, role `AGENTIC_PARSE_DEMO_RL`, warehouse `SFE_AGENTIC_PARSE_DEMO_WH`); use `./setup.sh` with `config.env` for other names.

Prerequisites are the same as [QUICKSTART.md](QUICKSTART.md): ACCOUNTADMIN, cross-region inference if your region lacks a model, and optionally the Snowflake Documentation Cortex Knowledge Extension as database `SNOWFLAKE_DOCUMENTATION` (see QUICKSTART). **Without that database paste [`snowsight/install_no_docs.sql`](../snowsight/install_no_docs.sql) instead of `install.sql`**: identical, but it runs `snowsight/no_docs/01_setup.sql` and `snowsight/no_docs/09b_agents.sql` (no docs grant, agents without the docs tool). `install.sql` itself fails at the grant when the database is missing.

## 1. Objects, corpus, agents (not billed)

Open a SQL worksheet, paste [`snowsight/install.sql`](../snowsight/install.sql) and **Run All**. It:

1. Creates an API integration for `https://github.com/sfc-gh-jkang/` and a Git repository clone `SNOWFLAKE_EXAMPLE.PUBLIC.AGENTIC_PARSE_DEMO_REPO` (Git integration: https://docs.snowflake.com/en/developer-guide/git/git-setting-up-public).
2. Runs `sql/01_setup.sql` to `sql/09b_agents.sql` from the clone with `EXECUTE IMMEDIATE FROM` (https://docs.snowflake.com/en/sql-reference/sql/execute-immediate-from).
3. Copies the corpus and scoring code from the clone with `COPY FILES` instead of `PUT`.
4. Loads the design docs for the agent's explain tool with an anonymous Python procedure that imports `scripts/load_design_docs.py` from the clone.

The repository must be public for this to work as written. While it is private, add a GitHub token as a secret, list it in the integration's `ALLOWED_AUTHENTICATION_SECRETS` and pass it as `GIT_CREDENTIALS` (https://docs.snowflake.com/en/developer-guide/git/git-setting-up-private).

## 2. Parse the corpus (billed)

Paste and run [`snowsight/parse_corpus.sql`](../snowsight/parse_corpus.sql). About 0.28 AI credits for 22 pages in three modes (measured on the author's demo account, Oct 2026). It runs one parse at a time (a few minutes in total) and skips pairs already parsed, so a re-run costs nothing.

## 3. The app: needs the Snowflake CLI

The web app is a Snowflake App Runtime application service. The documented deploy paths are `snow app deploy` and Cortex Code, which uses the CLI (https://docs.snowflake.com/en/developer-guide/snowflake-app-runtime/getting-started). I found no documented SQL-only way to build and deploy it from a worksheet, so this step needs a machine with the Snowflake CLI and the repo:

```bash
git clone https://github.com/sfc-gh-jkang/agentic-parse-demo-public.git agentic-parse-demo
cd agentic-parse-demo/web
snow app deploy --connection <your-connection> --role AGENTIC_PARSE_DEMO_RL --warehouse SFE_AGENTIC_PARSE_DEMO_WH
```

Without the app you still have the whole data side and the Snowflake Intelligence agent `AGENTIC_PARSE_DEMO_SI_AGENT` (open Snowflake Intelligence in Snowsight and pick "Agentic Parse Demo (Snowflake Intelligence)"); it has the same tools as the in-app agent except the screen control.

## Clean up

> **Warning: this deletes the demo.** It drops the app, its data, the agents, the warehouse, the role and the Git clone. It cannot be undone. If you recreate the app afterwards it gets a **new URL**, so any link you shared stops working.

The block refuses to run as pasted: it raises an error before dropping anything until you edit two things. First check the names in the `DECLARE` section match your install (they are the defaults this guide installs). Then change `confirm` from `'EDIT ME'` to `'DELETE '` followed by the schema name, for example `'DELETE AGENTIC_PARSE_DEMO'`. Each name must be a plain identifier (letters, digits, `_`, `$`).

```sql
USE ROLE ACCOUNTADMIN;
EXECUTE IMMEDIATE $$
DECLARE
  confirm VARCHAR DEFAULT 'EDIT ME';  -- set to 'DELETE <schema name>' to allow the drops below
  db VARCHAR DEFAULT 'SNOWFLAKE_EXAMPLE';
  sch VARCHAR DEFAULT 'AGENTIC_PARSE_DEMO';
  app VARCHAR DEFAULT 'AGENTIC_PARSE_DEMO';
  wh VARCHAR DEFAULT 'SFE_AGENTIC_PARSE_DEMO_WH';
  rl VARCHAR DEFAULT 'AGENTIC_PARSE_DEMO_RL';
  repo VARCHAR DEFAULT 'AGENTIC_PARSE_DEMO_REPO';
  git_api VARCHAR DEFAULT 'AGENTIC_PARSE_DEMO_GIT_API';
  not_confirmed EXCEPTION (-20001, 'Not confirmed: edit confirm to DELETE <schema name> after checking the names. Nothing was dropped.');
  bad_name EXCEPTION (-20002, 'A name is not a plain identifier. Nothing was dropped.');
BEGIN
  IF (confirm IS DISTINCT FROM 'DELETE ' || sch) THEN RAISE not_confirmed; END IF;
  IF (NOT REGEXP_LIKE(db || ',' || sch || ',' || app || ',' || wh || ',' || rl || ',' || repo || ',' || git_api, '^[A-Za-z0-9_$,]+$')) THEN RAISE bad_name; END IF;
  EXECUTE IMMEDIATE 'DROP APPLICATION SERVICE IF EXISTS ' || db || '.' || sch || '.' || app;
  BEGIN
    EXECUTE IMMEDIATE 'ALTER SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT DROP AGENT ' || db || '.' || sch || '.AGENTIC_PARSE_DEMO_SI_AGENT';
  EXCEPTION WHEN OTHER THEN NULL;  -- not listed
  END;
  EXECUTE IMMEDIATE 'DROP SCHEMA IF EXISTS ' || db || '.' || sch || ' CASCADE';
  EXECUTE IMMEDIATE 'DROP WAREHOUSE IF EXISTS ' || wh;
  EXECUTE IMMEDIATE 'DROP ROLE IF EXISTS ' || rl;
  EXECUTE IMMEDIATE 'DROP GIT REPOSITORY IF EXISTS ' || db || '.PUBLIC.' || repo;
  EXECUTE IMMEDIATE 'DROP API INTEGRATION IF EXISTS ' || git_api;
  RETURN 'Dropped ' || db || '.' || sch || ', ' || wh || ', ' || rl || ', ' || repo || ', ' || git_api;
END;
$$;
```

## What was tested (2026-11-02)

- `install.sql` and `parse_corpus.sql` ran end to end with `snow sql -f` against a second install (`SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO_PKGTEST`), with the git clone replaced by a **stage copy** of the same files rendered to the test names (pointing the clone at the default names would have modified the live install). Every `EXECUTE IMMEDIATE FROM`, `COPY FILES` and the design-doc procedure succeeded (97 chunks). `parse_corpus.sql` ran with every pair already parsed, so its loop ran 0 billed parses; the path that calls `PARSE_DOCUMENT` from the loop was not exercised.
- The Git clone itself was tested separately against the private repo with a token secret: `CREATE GIT REPOSITORY` and `FETCH` succeeded and `LS` listed `sql/01_setup.sql` on the branch. The public, secret-free form in `install.sql` has not run, because the repo is not public yet.
- Clean-up block (2026-11-10): ran with `snow sql -f` against throwaway objects (`SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO_OSTESTCLEAN`, its warehouse and role) with only the `DECLARE` names changed. Unedited, it raised `-20001 Not confirmed` and all three objects were still there; with `confirm` edited, it dropped them and `SHOW` returned nothing. It was not run against the default names.
- Not tested: pasting into a Snowsight worksheet with Run All (the statements are the same; Snowsight runs them in one session).
