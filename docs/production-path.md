# Production path

How to run AI_PARSE_DOCUMENT AGENTIC on real documents as they arrive, instead of a demo. It is the same shape as the demo (raw result stored once, read many times, ADR 0001), automated: **stage → directory table stream → task → results table → Cortex Search → agent**, with cost read from usage telemetry.

**Every statement below was executed** on 2026-11-01 by `scripts/verify_production_path.py` in a scratch schema `SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_PROD_SCRATCH` (role ACCOUNTADMIN, warehouse `SFE_AGENTIC_PARSE_DEMO_WH`): it created everything, dropped a 1-page JPG and a 1-page PDF on the stage, waited for the task, checked the rows, queried search, asked the agent, ran the cost query, then `DROP SCHEMA` and confirmed with `SHOW SCHEMAS` (0 rows). The SQL lives in `sql/production_path/production_path.sql`; `<SCHEMA>`, `<WH>` and `<DB>` are placeholders the script fills.

Docs: pipeline pattern https://docs.snowflake.com/en/user-guide/data-load-dirtables-pipeline ; automatic directory refresh on internal stages https://docs.snowflake.com/en/user-guide/data-load-dirtables-auto ; streams on directory tables https://docs.snowflake.com/en/sql-reference/sql/create-stream ; tasks https://docs.snowflake.com/en/user-guide/tasks-intro ; AI_PARSE_DOCUMENT https://docs.snowflake.com/en/sql-reference/functions/ai_parse_document ; Cortex Search https://docs.snowflake.com/en/sql-reference/sql/create-cortex-search ; Cortex Search as an agent tool https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-search/cortex-search-agents ; usage view https://docs.snowflake.com/en/sql-reference/account-usage/cortex_ai_functions_usage_history

```sql
-- Production path for AI_PARSE_DOCUMENT AGENTIC: stage -> directory table stream -> task -> results table
-- -> Cortex Search -> agent, with cost from CORTEX_AI_FUNCTIONS_USAGE_HISTORY.
-- Every statement here is executed by scripts/verify_production_path.py in the scratch schema
-- SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_PROD_SCRATCH (dropped afterwards). <SCHEMA> and <WH> are substituted.
-- Docs: https://docs.snowflake.com/en/user-guide/data-load-dirtables-pipeline

-- 1. Stage: server-side encryption is required by AI_PARSE_DOCUMENT; AUTO_REFRESH keeps the directory
--    table (and so the stream) current when files are uploaded, without a manual ALTER STAGE ... REFRESH.
CREATE STAGE <SCHEMA>.INBOX
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
  DIRECTORY = (ENABLE = TRUE AUTO_REFRESH = TRUE);

-- 2. Stream on the stage's directory table: one row per new file.
CREATE STREAM <SCHEMA>.INBOX_NEW ON STAGE <SCHEMA>.INBOX;

-- 3. Results: keep the raw OBJECT. AI_PARSE_DOCUMENT returns OBJECT; never wrap it in PARSE_JSON.
CREATE TABLE <SCHEMA>.PARSED_DOCS (
  RELATIVE_PATH STRING,
  RESULT        VARIANT,
  ERROR         STRING,
  PAGE_COUNT    INT,
  PARSED_AT     TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
);

-- 4. Task: runs only when the stream has rows; third argument TRUE returns errors in the result
--    instead of failing the whole batch. Keep the options argument CONSTANT: a per-row expression such as
--    IFF(path ILIKE '%.pdf', OBJECT_CONSTRUCT(...), OBJECT_CONSTRUCT(...)) is rejected for AGENTIC with
--    "Unsupported mode 'AGENTIC'. Supported modes: OCR, LAYOUT" (tested 2026-11-01). So paged files and
--    images are two branches, each with literal options (page_split applies to PDF/PPTX/DOCX only).
CREATE TASK <SCHEMA>.PARSE_NEW_DOCS
  WAREHOUSE = <WH>
  SCHEDULE = '1 MINUTE'
  WHEN SYSTEM$STREAM_HAS_DATA('<SCHEMA>.INBOX_NEW')
AS
  INSERT INTO <SCHEMA>.PARSED_DOCS (RELATIVE_PATH, RESULT, ERROR, PAGE_COUNT)
  WITH new_files AS (
    SELECT RELATIVE_PATH FROM <SCHEMA>.INBOX_NEW WHERE METADATA$ACTION = 'INSERT'
  ),
  parsed AS (
    SELECT RELATIVE_PATH,
           AI_PARSE_DOCUMENT(TO_FILE('@<SCHEMA>.INBOX', RELATIVE_PATH),
                             {'mode': 'AGENTIC', 'page_split': TRUE}, TRUE) AS r
    FROM new_files WHERE RELATIVE_PATH ILIKE ANY ('%.pdf', '%.pptx', '%.docx')
    UNION ALL
    SELECT RELATIVE_PATH,
           AI_PARSE_DOCUMENT(TO_FILE('@<SCHEMA>.INBOX', RELATIVE_PATH), {'mode': 'AGENTIC'}, TRUE) AS r
    FROM new_files WHERE NOT RELATIVE_PATH ILIKE ANY ('%.pdf', '%.pptx', '%.docx')
  )
  SELECT RELATIVE_PATH, r, r:error::STRING, r:metadata:pageCount::INT FROM parsed;

ALTER TASK <SCHEMA>.PARSE_NEW_DOCS RESUME;

-- 5. One row per page (image files have no pages array: their content is top level).
CREATE VIEW <SCHEMA>.PARSED_PAGES AS
SELECT d.RELATIVE_PATH,
       COALESCE(p.value:index::INT, 0)                          AS PAGE_INDEX,
       COALESCE(p.value:content, d.RESULT:value:content)::STRING AS CONTENT
FROM <SCHEMA>.PARSED_DOCS d,
     LATERAL FLATTEN(INPUT => d.RESULT:value:pages, OUTER => TRUE) p
WHERE d.ERROR IS NULL;

-- 6. Cortex Search over the pages.
CREATE CORTEX SEARCH SERVICE <SCHEMA>.PARSED_PAGES_SEARCH
  ON CONTENT
  ATTRIBUTES RELATIVE_PATH, PAGE_INDEX
  WAREHOUSE = <WH>
  TARGET_LAG = '1 hour'
AS SELECT CONTENT, RELATIVE_PATH, PAGE_INDEX FROM <SCHEMA>.PARSED_PAGES;

-- 7. An agent that answers from the parsed pages.
CREATE AGENT <SCHEMA>.DOCS_AGENT
FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-5-5
instructions:
  response: "Answer only from the parsed documents and cite the file and page."
tools:
  - tool_spec:
      type: cortex_search
      name: parsed_pages
      description: "Pages of documents parsed with AI_PARSE_DOCUMENT AGENTIC mode"
tool_resources:
  parsed_pages:
    search_service: <SCHEMA>.PARSED_PAGES_SEARCH
    max_results: 5
    title_column: RELATIVE_PATH
    id_column: RELATIVE_PATH
$$;

-- 8. Cost of each task run, from usage telemetry. The task's query ids come from TASK_HISTORY; usage rows
--    can lag (NULL credits = not reported yet; never estimate).
SELECT t.QUERY_ID, t.COMPLETED_TIME, SUM(h.CREDITS) AS AI_CREDITS
FROM TABLE(<DB>.INFORMATION_SCHEMA.TASK_HISTORY(TASK_NAME => 'PARSE_NEW_DOCS')) t
LEFT JOIN SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY h
  ON h.QUERY_ID = t.QUERY_ID AND h.FUNCTION_NAME = 'AI_PARSE_DOCUMENT'
WHERE t.STATE = 'SUCCEEDED' AND t.QUERY_ID IS NOT NULL
GROUP BY 1, 2
ORDER BY 2;
```

## What the run showed

| Check | Result (2026-11-01) |
|---|---|
| Task picks up new files | Both files parsed 138 s after the PUT (1-minute schedule) |
| Result type | `OBJECT`, `ERROR` NULL, `PAGE_COUNT` 1 for both; stored as-is, read with `:` paths. No PARSE_JSON anywhere: it does not compile on an OBJECT |
| Pages view | 1 row per file (image: 248 chars, top-level `content`; PDF: 444 chars, `pages[]`) |
| Cortex Search | `SEARCH_PREVIEW` returned a hit after `ALTER CORTEX SEARCH SERVICE ... REFRESH` |
| Agent | `DATA_AGENT_RUN`: "The total on the receipt is $29.45 ... from the file receipt_photo.jpg". With `title_column`/`id_column` set to `RELATIVE_PATH` it cites the file; without them (first run) it said it could not tell which file |
| Cost query | The 2-page task run: 0.016360 AI credits, `MODEL_NAME` agentic (= 2 × 8.18 / 1,000). The usage row was there about 20 minutes after the run; until it lands `AI_CREDITS` is NULL. A run whose parse returned an error had no usage row |

## Two things that break it

**1. The options argument must be a constant.** A per-row expression such as `IFF(RELATIVE_PATH ILIKE '%.pdf', OBJECT_CONSTRUCT('mode','AGENTIC','page_split',TRUE), OBJECT_CONSTRUCT('mode','AGENTIC'))` makes every row fail with `Unsupported mode 'AGENTIC'. Supported modes: OCR, LAYOUT.` (reproduced interactively and in a task, 2026-11-01). The same call with a literal `{'mode': 'AGENTIC'}` works. Hence the two `UNION ALL` branches in the task: paged files with `page_split`, images without. That error is returned in the result (third argument TRUE), so check the `ERROR` column; it is not billed.

**2. A stream-gated task on an internal stage only fires if the directory table refreshes.** Directory tables on internal stages do not refresh on PUT unless `AUTO_REFRESH = TRUE`, so `SYSTEM$STREAM_HAS_DATA` stays false. Tested, one 1-page JPG each:

| Variant | Stage | Task | Fired? |
|---|---|---|---|
| A (used above) | `AUTO_REFRESH = TRUE` | `WHEN SYSTEM$STREAM_HAS_DATA` | Yes, 137 s |
| B | no auto-refresh | `WHEN SYSTEM$STREAM_HAS_DATA` | **No**: 305 s, task history only SKIPPED |
| C | no auto-refresh | no `WHEN`; body `BEGIN ALTER STAGE ... REFRESH; INSERT ...; END` | Yes, 77 s |

Use A. C works but starts the warehouse every minute even when nothing arrived. B is the pattern the Demo Agent used to suggest (QA round 7, finding 8); it never fires.

## Privileges

The demo role `AGENTIC_PARSE_DEMO_RL` cannot run this: it has no CREATE SCHEMA on `SNOWFLAKE_EXAMPLE` and no account-level EXECUTE TASK, on purpose. A production role needs CREATE STAGE/STREAM/TABLE/TASK/VIEW/CORTEX SEARCH SERVICE/AGENT on its schema, USAGE on a warehouse, the `SNOWFLAKE.CORTEX_USER` database role, EXECUTE TASK on the account, and `SNOWFLAKE.USAGE_VIEWER` (or IMPORTED PRIVILEGES on SNOWFLAKE) for the cost query.

## Re-run

```bash
uv run python scripts/verify_production_path.py            # main path + variants A B C, about 20 min, 4 to 5 billed pages
uv run python scripts/verify_production_path.py --variants # main path only, 2 billed pages
```
