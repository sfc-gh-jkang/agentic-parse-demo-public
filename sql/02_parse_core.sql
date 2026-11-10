-- Parse core (ADR 0001: every Parse Run is stored; reads come from storage).
USE ROLE AGENTIC_PARSE_DEMO_RL;
USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_WH;
USE SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO;

CREATE TABLE IF NOT EXISTS DOCUMENTS (
  DOC_ID       STRING PRIMARY KEY,
  STAGE_PATH   STRING NOT NULL,          -- path relative to @DOCS
  SOURCE       STRING NOT NULL,          -- 'corpus' | 'upload'
  FILE_TYPE    STRING,
  GROUND_TRUTH VARIANT,                  -- NULL for Uploaded Documents
  ADDED_AT     TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS PARSE_RUNS (
  RUN_ID       STRING DEFAULT UUID_STRING(),
  DOC_ID       STRING NOT NULL,
  MODE         STRING NOT NULL,          -- 'OCR' | 'LAYOUT' | 'AGENTIC'
  OPTIONS      VARIANT,
  RESULT       VARIANT,                  -- raw AI_PARSE_DOCUMENT output (return_error_details form)
  ERROR        STRING,
  PAGE_COUNT   NUMBER,
  QUERY_ID     STRING,                   -- joins to AI usage history for measured cost
  STARTED_AT   TIMESTAMP_LTZ,
  FINISHED_AT  TIMESTAMP_LTZ
);

-- One row per page per Parse Run. OCR without page_split returns a single content block.
CREATE OR REPLACE VIEW PARSE_PAGES AS
SELECT r.RUN_ID, r.DOC_ID, r.MODE, r.FINISHED_AT,
       COALESCE(p.value:index::INT, 0)                          AS PAGE_INDEX,
       COALESCE(p.value:content, r.RESULT:value:content)::STRING AS CONTENT,
       p.value:dimensions:width::INT                            AS PAGE_WIDTH,
       p.value:dimensions:height::INT                           AS PAGE_HEIGHT
FROM PARSE_RUNS r,
     LATERAL FLATTEN(INPUT => r.RESULT:value:pages, OUTER => TRUE) p
WHERE r.ERROR IS NULL;

-- One row per AGENTIC Visual.
-- Paged files (page_split) put Visuals in pages[].images with page pixel dimensions.
-- Image files put them in top-level value:images with no dimensions, so normalized
-- boxes are NULL there and consumers normalize against the image's natural size.
-- Result schema varies by image_type: chart/table/diagram use summary + details;
-- other uses description + visible_text; photo_with_text uses scene_description.
-- A failed Visual is {"results":{"description":"error"}}.
CREATE OR REPLACE VIEW PARSE_VISUALS AS
WITH src AS (
  SELECT r.RUN_ID, r.DOC_ID, r.MODE, r.FINISHED_AT,
         COALESCE(p.value:index::INT, 0) AS PAGE_INDEX,
         p.value:dimensions:width::INT  AS PAGE_WIDTH,
         p.value:dimensions:height::INT AS PAGE_HEIGHT,
         i.value AS IMG
  FROM PARSE_RUNS r,
       LATERAL FLATTEN(INPUT => r.RESULT:value:pages) p,
       LATERAL FLATTEN(INPUT => p.value:images) i
  WHERE r.MODE = 'AGENTIC' AND r.ERROR IS NULL
  UNION ALL
  SELECT r.RUN_ID, r.DOC_ID, r.MODE, r.FINISHED_AT, 0, NULL, NULL, i.value
  FROM PARSE_RUNS r,
       LATERAL FLATTEN(INPUT => r.RESULT:value:images) i
  WHERE r.MODE = 'AGENTIC' AND r.ERROR IS NULL
)
SELECT RUN_ID, DOC_ID, MODE, FINISHED_AT, PAGE_INDEX, PAGE_WIDTH, PAGE_HEIGHT,
       IMG:id::STRING                         AS VISUAL_ID,
       IMG:results:image_type::STRING         AS IMAGE_TYPE,
       COALESCE(IMG:results:summary, IMG:results:description,
                IMG:results:scene_description)::STRING AS SUMMARY,
       ARRAY_TO_STRING(IMG:results:visible_text, ' ') AS VISIBLE_TEXT,
       IMG:results:details                    AS DETAILS,
       IMG:results                            AS RESULTS,
       COALESCE(IMG:results:description::STRING = 'error', FALSE) AS FAILED,
       IMG:top_left_x::INT     AS X0_PX, IMG:top_left_y::INT     AS Y0_PX,
       IMG:bottom_right_x::INT AS X1_PX, IMG:bottom_right_y::INT AS Y1_PX,
       IMG:top_left_x     / NULLIF(PAGE_WIDTH, 0)  AS X0,
       IMG:top_left_y     / NULLIF(PAGE_HEIGHT, 0) AS Y0,
       IMG:bottom_right_x / NULLIF(PAGE_WIDTH, 0)  AS X1,
       IMG:bottom_right_y / NULLIF(PAGE_HEIGHT, 0) AS Y1
FROM src;

-- Latest Parse Run per Document and Parse Mode: what the app and agent read by default.
CREATE OR REPLACE VIEW LATEST_RUNS AS
SELECT * FROM PARSE_RUNS
QUALIFY ROW_NUMBER() OVER (PARTITION BY DOC_ID, MODE ORDER BY FINISHED_AT DESC, RUN_ID DESC) = 1;

-- PARSE_DOCUMENT: run one Parse Mode on one Document and store the Parse Run.
-- Runs as owner and spends AI credits: granting USAGE on it grants the ability to spend.
-- Never PARSE_JSON the result: on this account AI_PARSE_DOCUMENT returns OBJECT.
-- Never pass extract_images with AGENTIC (unsupported).
CREATE OR REPLACE PROCEDURE PARSE_DOCUMENT(P_DOC_ID STRING, P_MODE STRING, P_PAGE_FILTER ARRAY DEFAULT NULL)
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  v_mode STRING DEFAULT UPPER(:P_MODE);
  v_path STRING;
  v_run  STRING DEFAULT UUID_STRING();
  v_opts VARIANT;
  v_start TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP();
BEGIN
  IF (v_mode NOT IN ('OCR', 'LAYOUT', 'AGENTIC')) THEN
    RETURN 'ERROR: mode must be OCR, LAYOUT or AGENTIC';
  END IF;
  SELECT MAX(STAGE_PATH) INTO :v_path FROM DOCUMENTS WHERE DOC_ID = :P_DOC_ID;
  IF (v_path IS NULL) THEN
    RETURN 'ERROR: unknown document ' || :P_DOC_ID;
  END IF;
  -- page_split only applies to PDF/PPTX/DOCX; images are always one page.
  v_opts := IFF(:P_PAGE_FILTER IS NULL,
                IFF(REGEXP_LIKE(:v_path, '.*\\.(pdf|pptx|docx)$', 'i'),
                    OBJECT_CONSTRUCT('mode', :v_mode, 'page_split', TRUE),
                    OBJECT_CONSTRUCT('mode', :v_mode)),
                OBJECT_CONSTRUCT('mode', :v_mode, 'page_filter', :P_PAGE_FILTER));
  INSERT INTO PARSE_RUNS (RUN_ID, DOC_ID, MODE, OPTIONS, RESULT, ERROR, PAGE_COUNT, STARTED_AT, FINISHED_AT)
  SELECT :v_run, :P_DOC_ID, :v_mode, :v_opts, r,
         r:error::STRING, r:metadata:pageCount::INT, :v_start, CURRENT_TIMESTAMP()
  FROM (SELECT AI_PARSE_DOCUMENT(TO_FILE('@SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCS', :v_path), :v_opts, TRUE) AS r);
  -- The INSERT is the query that consumed AI credits; keep its id to join usage history.
  UPDATE PARSE_RUNS SET QUERY_ID = LAST_QUERY_ID() WHERE RUN_ID = :v_run;
  RETURN :v_run;
END;
$$;
