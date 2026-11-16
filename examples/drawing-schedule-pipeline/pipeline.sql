-- Fixture schedule pipeline for electrical drawings
-- Drawing PDFs land on a stage -> schedules are auto-cropped inside Snowflake -> AI_EXTRACT reads each crop
-- -> one row per fixture, each catalog number checked against the drawing's own text layer.
--
-- Architecture (stream -> task -> incremental dynamic tables):
--   @DRAWINGS --stream--> DS_DRAWING_TASK --CALL--> DS_CROP_DRAWINGS() --> @CROPS + DS_CROP_LOG
--   DS_CROP_LOG --> DT_DS_TITLE_BLOCK, DT_DS_FIXTURE_EXTRACT --> DT_DS_FIXTURES --> view FIXTURE_SCHEDULE
--
-- Cost: AI_EXTRACT is billed per token; see https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql-cost
-- Replace SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE and FULLSTACK_WH with your own database, schema and warehouse.

CREATE SCHEMA IF NOT EXISTS SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE;
USE SCHEMA SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE;
USE WAREHOUSE FULLSTACK_WH;

-- 1. Stages. Server-side encryption is required by the AI file functions. AUTO_REFRESH on internal stages
--    is available on AWS accounts; elsewhere run ALTER STAGE DRAWINGS REFRESH after uploads.
--    https://docs.snowflake.com/en/user-guide/data-load-dirtables-auto
CREATE STAGE IF NOT EXISTS DRAWINGS DIRECTORY = (ENABLE = TRUE AUTO_REFRESH = TRUE) ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE');
CREATE STAGE IF NOT EXISTS CROPS    DIRECTORY = (ENABLE = TRUE) ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE');
CREATE STAGE IF NOT EXISTS CODE     ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE');
-- PUT file://examples/drawing-schedule-pipeline/crop_schedules.py @CODE AUTO_COMPRESS = FALSE OVERWRITE = TRUE;

-- 2. Logs. One row per drawing and one row per cropped region. Change tracking lets the dynamic tables
--    read only new crops, so AI_EXTRACT runs once per crop.
CREATE TABLE IF NOT EXISTS DS_DRAWING_LOG (
  RELATIVE_PATH STRING, FILE_NAME STRING, FILE_SIZE NUMBER, LAST_MODIFIED TIMESTAMP_LTZ,
  INGESTED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(), CROPPED_AT TIMESTAMP_NTZ, CROP_STATUS STRING
);
CREATE TABLE IF NOT EXISTS DS_CROP_LOG (
  DRAWING_PATH STRING, PAGE_NO NUMBER, REGION STRING, CROP_PATH STRING, REGION_TEXT STRING,
  CROPPED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);
ALTER TABLE DS_CROP_LOG SET CHANGE_TRACKING = TRUE;

-- 3. Crop procedure: logs new drawings from the stream, then crops every schedule and the title block.
--    PDFs never leave the account. pdfplumber, pypdfium2 and pillow come from the Snowflake Anaconda channel.
CREATE OR REPLACE PROCEDURE DS_CROP_DRAWINGS()
RETURNS STRING
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python', 'pdfplumber', 'pypdfium2', 'pillow')
IMPORTS = ('@SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE.CODE/crop_schedules.py')
HANDLER = 'main'
AS
$$
import io
import os
from crop_schedules import crop_pdf

def main(session):
    session.sql("""
        INSERT INTO DS_DRAWING_LOG (RELATIVE_PATH, FILE_NAME, FILE_SIZE, LAST_MODIFIED)
        SELECT RELATIVE_PATH, SPLIT_PART(RELATIVE_PATH, '/', -1), SIZE, LAST_MODIFIED::TIMESTAMP_LTZ
        FROM DS_DRAWINGS_STREAM
        WHERE METADATA$ACTION = 'INSERT' AND RELATIVE_PATH ILIKE '%.pdf'
    """).collect()
    todo = session.sql("SELECT RELATIVE_PATH FROM DS_DRAWING_LOG WHERE CROPPED_AT IS NULL").collect()
    crops = 0
    for row in todo:
        rel = row["RELATIVE_PATH"]
        stem = os.path.splitext(rel)[0]
        status = "OK"
        try:
            with session.file.get_stream(f"@DRAWINGS/{rel}") as fh:
                pdf_bytes = fh.read()
            records = []
            for page_no, region, png, text in crop_pdf(pdf_bytes):
                crop_path = f"{stem}/p{page_no:03d}_{region}.png"
                session.file.put_stream(io.BytesIO(png), f"@CROPS/{crop_path}",
                                        auto_compress=False, overwrite=True)
                records.append((rel, page_no, region, crop_path, text))
            if records:
                session.create_dataframe(
                    records, schema=["DRAWING_PATH", "PAGE_NO", "REGION", "CROP_PATH", "REGION_TEXT"]
                ).write.mode("append").save_as_table("DS_CROP_LOG", column_order="name")
            crops += len(records)
            status = f"OK: {len(records)} regions"
        except Exception as exc:          # one bad drawing must not block the rest of the batch
            status = f"ERROR: {str(exc)[:500]}"
        session.sql("UPDATE DS_DRAWING_LOG SET CROPPED_AT = CURRENT_TIMESTAMP(), CROP_STATUS = ? "
                    "WHERE RELATIVE_PATH = ?", params=[status, rel]).collect()
    session.sql("ALTER STAGE CROPS REFRESH").collect()
    return f"{len(todo)} drawing(s), {crops} crop(s)"
$$;

-- 4. Stream + task: new PDFs on @DRAWINGS trigger the crop procedure.
CREATE OR REPLACE STREAM DS_DRAWINGS_STREAM ON STAGE DRAWINGS;
CREATE OR REPLACE TASK DS_DRAWING_TASK
  WAREHOUSE = FULLSTACK_WH
  SCHEDULE = '5 MINUTE'
  WHEN SYSTEM$STREAM_HAS_DATA('SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE.DS_DRAWINGS_STREAM')
AS
  CALL DS_CROP_DRAWINGS();

-- 5. Title block: project, address, job, date and sheet for every drawing.
CREATE OR REPLACE DYNAMIC TABLE DT_DS_TITLE_BLOCK
  TARGET_LAG = DOWNSTREAM WAREHOUSE = FULLSTACK_WH REFRESH_MODE = INCREMENTAL
AS
WITH raw AS (
  SELECT c.DRAWING_PATH, c.PAGE_NO,
    AI_EXTRACT(
      file => TO_FILE('@SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE.CROPS', c.CROP_PATH),
      responseFormat => {
        'project_name':    'Client or store name printed in large letters. NOT the architect firm name.',
        'project_address': 'Project street address, city, state and ZIP. NOT the architect or engineer address.',
        'job_number':      'Value next to JOB NO.',
        'sheet_date':      'Value next to DATE, in MM/DD/YY as printed.',
        'sheet_number':    'Sheet number in the SHEET NO. box, e.g. E2.1.',
        'sheet_title':     'Sheet title above the DATE box, e.g. LIGHTING & PANEL SCHEDULES.'
      }) AS RAW_EXTRACT
  FROM DS_CROP_LOG c
  WHERE c.REGION = 'title_block'
)
SELECT DRAWING_PATH, PAGE_NO,
  RAW_EXTRACT:response:project_name::STRING    AS PROJECT_NAME,
  RAW_EXTRACT:response:project_address::STRING AS PROJECT_ADDRESS,
  RAW_EXTRACT:response:job_number::STRING      AS JOB_NUMBER,
  RAW_EXTRACT:response:sheet_date::STRING      AS SHEET_DATE,
  RAW_EXTRACT:response:sheet_number::STRING    AS SHEET_NUMBER,
  RAW_EXTRACT:response:sheet_title::STRING     AS SHEET_TITLE,
  RAW_EXTRACT
FROM raw;

-- 6. Fixture schedule: every row of the LIGHT FIXTURE SCHEDULE as parallel arrays.
CREATE OR REPLACE DYNAMIC TABLE DT_DS_FIXTURE_EXTRACT
  TARGET_LAG = DOWNSTREAM WAREHOUSE = FULLSTACK_WH REFRESH_MODE = INCREMENTAL
AS
SELECT c.DRAWING_PATH, c.PAGE_NO, c.CROP_PATH, c.REGION_TEXT,
  AI_EXTRACT(
    file => TO_FILE('@SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE.CROPS', c.CROP_PATH),
    responseFormat => {'schema': {'type': 'object', 'properties': {
      'fixtures': {'type': 'object', 'description': 'Every row of the LIGHT FIXTURE SCHEDULE table, top to bottom',
        'column_ordering': ['type', 'description', 'manufacturer', 'catalog_number', 'lamps', 'volt', 'watts', 'location'],
        'properties': {
          'type':           {'type': 'array', 'description': 'TYPE column code, e.g. A, AE, C1E, EM1'},
          'description':    {'type': 'array', 'description': 'DESCRIPTION column'},
          'manufacturer':   {'type': 'array', 'description': 'Manufacturer name from the MANUFACTURER column, without any catalog number'},
          'catalog_number': {'type': 'array', 'description': 'Catalog number, copied exactly: the CATALOG NO. column if there is one, otherwise the line after the # in the MANUFACTURER column'},
          'lamps':          {'type': 'array', 'description': 'LAMPS column, e.g. LED 4000K'},
          'volt':           {'type': 'array', 'description': 'VOLT column'},
          'watts':          {'type': 'array', 'description': 'WATTS column'},
          'location':       {'type': 'array', 'description': 'First underlined line of REMARKS, the area such as OFFICES or EXTERIOR'}
        }}}}}) AS RAW_EXTRACT
FROM DS_CROP_LOG c
WHERE c.REGION = 'light_fixture_schedule';

-- 7. One row per fixture, with a text-layer check on every catalog number.
--    CATALOG_IN_TEXT_LAYER = TRUE: the value appears verbatim in the drawing's own text.
--    FALSE: an OCR misread to review; NULL: the drawing is a scan with no text layer.
CREATE OR REPLACE DYNAMIC TABLE DT_DS_FIXTURES
  TARGET_LAG = '5 minutes' WAREHOUSE = FULLSTACK_WH REFRESH_MODE = INCREMENTAL
AS
SELECT
  e.DRAWING_PATH, e.PAGE_NO,
  t.PROJECT_NAME, t.PROJECT_ADDRESS, t.JOB_NUMBER, t.SHEET_DATE, t.SHEET_NUMBER,
  f.index + 1                                                           AS ROW_NUM,
  f.value::STRING                                                       AS FIXTURE_TYPE,
  e.RAW_EXTRACT:response:fixtures:manufacturer[f.index]::STRING         AS MANUFACTURER,
  e.RAW_EXTRACT:response:fixtures:catalog_number[f.index]::STRING       AS CATALOG_NUMBER,
  e.RAW_EXTRACT:response:fixtures:lamps[f.index]::STRING                AS LAMPS,
  e.RAW_EXTRACT:response:fixtures:volt[f.index]::STRING                 AS VOLT,
  e.RAW_EXTRACT:response:fixtures:watts[f.index]::STRING                AS WATTS,
  e.RAW_EXTRACT:response:fixtures:location[f.index]::STRING             AS LOCATION,
  e.RAW_EXTRACT:response:fixtures:description[f.index]::STRING          AS DESCRIPTION,
  CASE WHEN COALESCE(e.REGION_TEXT, '') = '' THEN NULL
       ELSE CONTAINS(REPLACE(e.REGION_TEXT, ' ', ''),
                     REPLACE(e.RAW_EXTRACT:response:fixtures:catalog_number[f.index]::STRING, ' ', ''))
  END                                                                   AS CATALOG_IN_TEXT_LAYER
FROM DT_DS_FIXTURE_EXTRACT e
JOIN DT_DS_TITLE_BLOCK t ON t.DRAWING_PATH = e.DRAWING_PATH AND t.PAGE_NO = e.PAGE_NO,
LATERAL FLATTEN(input => e.RAW_EXTRACT:response:fixtures:type) f;

CREATE OR REPLACE VIEW FIXTURE_SCHEDULE AS SELECT * FROM DT_DS_FIXTURES;

-- 8. Verify every AI dynamic table is INCREMENTAL before resuming the task.
SHOW DYNAMIC TABLES LIKE 'DT_DS%' IN SCHEMA SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE;
SELECT "name", "refresh_mode", "refresh_mode_reason" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) ORDER BY "name";

-- 9. Go live. From here, uploading a PDF to @DRAWINGS is the only step.
-- ALTER TASK DS_DRAWING_TASK RESUME;
-- PUT file://your_drawing.pdf @DRAWINGS AUTO_COMPRESS = FALSE;
-- SELECT * FROM FIXTURE_SCHEDULE ORDER BY DRAWING_PATH, ROW_NUM;
