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
