-- The value story and the data product (T21 pass 5). Read-only views over stored data; nothing here parses or bills.
--   VISUAL_DATA_POINTS : every chart value from the latest AGENTIC Parse Run as one row (chart values as rows).
--   VALUE_BY_DOC_MODE  : per Document and Parse Mode: pages, facts found, relations found, pages left to check by hand,
--                        and the credits to parse the Document (measured credits per page x pages).
--   VALUE_BY_MODE      : the same per Parse Mode across the scored corpus, with COST_PER_CORRECT_FACT.
--   VALUE_HARD_PAGES   : pages where OCR or LAYOUT missed a Ground Truth fact (candidates to route to AGENTIC).
-- Run after 07_upload.sql (needs DOCUMENT_CATALOG, MODE_COMPARISONS, PARSE_RUN_COST, PARSE_VISUALS, LATEST_RUNS).
USE ROLE AGENTIC_PARSE_DEMO_RL;
USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_WH;
USE SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO;

-- One row per labelled value in a chart Visual, from the latest AGENTIC run only (older runs would repeat every value).
-- PAGE_INDEX is 0-based like PARSE_PAGES; PAGE_NUMBER is the 1-based number people see.
-- VALUE is the number parsed out of the model's value (it may arrive as "$29,305" or "80%"); VALUE_TEXT keeps what was read.
-- UNIT is the y axis unit, else its label, else NULL (pie charts have none).
CREATE OR REPLACE VIEW VISUAL_DATA_POINTS AS
SELECT v.DOC_ID || '/' || v.PAGE_INDEX || '/' || v.VISUAL_ID || '/' || s.index || '/' || p.index AS POINT_ID,
       v.DOC_ID, v.PAGE_INDEX, v.PAGE_INDEX + 1 AS PAGE_NUMBER, v.VISUAL_ID, v.MODE, v.RUN_ID,
       v.DETAILS:title::STRING                AS CHART_TITLE,
       v.DETAILS:chart_type::STRING           AS CHART_TYPE,
       p.value:label::STRING                  AS LABEL,
       s.value:name::STRING                   AS SERIES,
       TRY_TO_DOUBLE(REGEXP_REPLACE(p.value:value::STRING, '[^0-9.-]', '')) AS VALUE,
       p.value:value::STRING                  AS VALUE_TEXT,
       COALESCE(NULLIF(v.DETAILS:y_axis:units::STRING, ''), NULLIF(v.DETAILS:y_axis:label::STRING, '')) AS UNIT
FROM PARSE_VISUALS v,
     LATERAL FLATTEN(INPUT => v.DETAILS:series) s,
     LATERAL FLATTEN(INPUT => s.value:points) p
WHERE v.IMAGE_TYPE = 'chart' AND NOT v.FAILED
  AND v.RUN_ID IN (SELECT RUN_ID FROM LATEST_RUNS WHERE MODE = 'AGENTIC' AND ERROR IS NULL);

-- Measured credits per billed page for each Parse Mode (metered usage only; runs whose usage has not landed carry none).
CREATE OR REPLACE VIEW VALUE_CREDITS_PER_PAGE AS
SELECT MODE, SUM(CREDITS) AS CREDITS, SUM(PAGES_BILLED) AS PAGES_BILLED,
       SUM(CREDITS) / NULLIF(SUM(PAGES_BILLED), 0) AS CREDITS_PER_PAGE
FROM PARSE_RUN_COST
WHERE CREDITS IS NOT NULL AND NOT PENDING
GROUP BY MODE;

CREATE OR REPLACE VIEW VALUE_BY_DOC_MODE AS
WITH missed AS (
  SELECT c.DOC_ID, c.MODE, COUNT(DISTINCT f.value:page::INT) AS PAGES_TO_CHECK
  FROM MODE_COMPARISONS c, LATERAL FLATTEN(INPUT => c.MISSED:facts) f
  GROUP BY c.DOC_ID, c.MODE
),
scored AS (
  SELECT c.DOC_ID, c.MODE, d.PAGES,
         c.IMAGE_FACTS + c.TEXT_FACTS AS FACTS, c.IMAGE_FACTS_FOUND + c.TEXT_FACTS_FOUND AS FACTS_FOUND,
         c.RELATIONS, c.RELATIONS_FOUND, k.CREDITS_PER_PAGE,
         d.PAGES * k.CREDITS_PER_PAGE AS CREDITS_TO_PARSE
  FROM MODE_COMPARISONS c
  JOIN DOCUMENT_CATALOG d USING (DOC_ID)
  JOIN VALUE_CREDITS_PER_PAGE k ON k.MODE = c.MODE
)
SELECT s.DOC_ID, s.MODE, s.PAGES, s.FACTS, s.FACTS_FOUND, s.RELATIONS, s.RELATIONS_FOUND,
       COALESCE(m.PAGES_TO_CHECK, 0) AS PAGES_TO_CHECK,
       s.CREDITS_PER_PAGE, s.CREDITS_TO_PARSE,
       MAX(IFF(s.MODE = 'AGENTIC', s.FACTS_FOUND, NULL)) OVER (PARTITION BY s.DOC_ID) - s.FACTS_FOUND         AS FACTS_GAP_TO_AGENTIC,
       MAX(IFF(s.MODE = 'AGENTIC', s.RELATIONS_FOUND, NULL)) OVER (PARTITION BY s.DOC_ID) - s.RELATIONS_FOUND AS RELATIONS_GAP_TO_AGENTIC
FROM scored s LEFT JOIN missed m USING (DOC_ID, MODE);

CREATE OR REPLACE VIEW VALUE_BY_MODE AS
SELECT MODE, SUM(PAGES) AS CORPUS_PAGES, MAX(CREDITS_PER_PAGE) AS CREDITS_PER_PAGE,
       SUM(CREDITS_TO_PARSE) AS CORPUS_CREDITS,
       SUM(FACTS) AS FACTS, SUM(FACTS_FOUND) AS FACTS_FOUND,
       SUM(RELATIONS) AS RELATIONS, SUM(RELATIONS_FOUND) AS RELATIONS_FOUND,
       SUM(PAGES_TO_CHECK) AS PAGES_TO_CHECK,
       SUM(CREDITS_TO_PARSE) / NULLIF(SUM(FACTS_FOUND), 0) AS COST_PER_CORRECT_FACT
FROM VALUE_BY_DOC_MODE
GROUP BY MODE;

CREATE OR REPLACE VIEW VALUE_HARD_PAGES AS
SELECT DISTINCT c.DOC_ID, f.value:page::INT AS PAGE_INDEX
FROM MODE_COMPARISONS c, LATERAL FLATTEN(INPUT => c.MISSED:facts) f
WHERE c.MODE IN ('OCR', 'LAYOUT');
