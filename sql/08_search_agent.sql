-- Search services for the demo agent (T9). Idempotent. Load DESIGN_DOCS with scripts/load_design_docs.py after this file.
USE ROLE AGENTIC_PARSE_DEMO_RL;
USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_WH;
USE SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO;

-- One row per page and per Visual summary, from the latest AGENTIC Parse Run of each Document.
CREATE OR REPLACE VIEW SEARCH_CHUNKS AS
WITH runs AS (
  SELECT RUN_ID FROM LATEST_RUNS WHERE MODE = 'AGENTIC' AND ERROR IS NULL
)
SELECT p.CONTENT AS CHUNK, p.DOC_ID, p.PAGE_INDEX AS PAGE, 'page' AS KIND, NULL::STRING AS VISUAL, p.MODE
FROM PARSE_PAGES p JOIN runs r ON p.RUN_ID = r.RUN_ID
WHERE NULLIF(TRIM(p.CONTENT), '') IS NOT NULL
UNION ALL
-- CONCAT_WS returns NULL when any argument is NULL; ARRAY_CONSTRUCT_COMPACT drops NULL parts instead.
SELECT ARRAY_TO_STRING(ARRAY_CONSTRUCT_COMPACT(
         'Visual ' || v.VISUAL_ID || ' (' || COALESCE(v.IMAGE_TYPE, 'unknown') || ') on page ' || v.PAGE_INDEX || ' of ' || v.DOC_ID,
         v.SUMMARY,
         IFF(NULLIF(v.VISIBLE_TEXT, '') IS NULL, NULL, 'Visible text: ' || v.VISIBLE_TEXT),
         IFF(v.RESULTS:details IS NULL, NULL, 'Details: ' || v.RESULTS:details::STRING)), '\n') AS CHUNK,
       v.DOC_ID, v.PAGE_INDEX AS PAGE, 'visual' AS KIND, v.VISUAL_ID AS VISUAL, v.MODE
FROM PARSE_VISUALS v JOIN runs r ON v.RUN_ID = r.RUN_ID
WHERE NOT COALESCE(v.FAILED, FALSE) AND NULLIF(TRIM(v.SUMMARY), '') IS NOT NULL;

CREATE OR REPLACE CORTEX SEARCH SERVICE PARSED_DOCS_SEARCH
  ON CHUNK
  ATTRIBUTES DOC_ID, PAGE, KIND
  WAREHOUSE = SFE_AGENTIC_PARSE_DEMO_WH
  TARGET_LAG = '1 hour'
  COMMENT = 'Pages and Visual summaries of the latest AGENTIC Parse Run per Document'
AS SELECT CHUNK, DOC_ID, PAGE, KIND, VISUAL, MODE FROM SEARCH_CHUNKS;

CREATE TABLE IF NOT EXISTS DESIGN_DOCS (
  PATH STRING NOT NULL COMMENT 'repo-relative markdown path',
  SECTION STRING COMMENT 'heading path, e.g. Spec > Solution',
  CHUNK STRING NOT NULL
) COMMENT = 'Design docs chunked by heading; loaded by scripts/load_design_docs.py';

CREATE OR REPLACE CORTEX SEARCH SERVICE DESIGN_DOCS_SEARCH
  ON CHUNK
  ATTRIBUTES PATH, SECTION
  WAREHOUSE = SFE_AGENTIC_PARSE_DEMO_WH
  TARGET_LAG = '1 hour'
  COMMENT = 'README, SPEC, ADRs, GLOSSARY and parse notes of this demo'
AS SELECT CHUNK, PATH, SECTION FROM DESIGN_DOCS;

-- The agent itself (with these and the action tools) is created in 09_agent_tools.sql.
