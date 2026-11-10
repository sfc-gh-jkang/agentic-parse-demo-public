-- Read paths for the web app. Owner's rights: the app's role reads stored data only.
USE ROLE AGENTIC_PARSE_DEMO_RL;
USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_WH;
USE SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO;

-- One row per Document for the list view: page count and which Parse Modes have a stored run.
CREATE OR REPLACE VIEW DOCUMENT_CATALOG AS
SELECT d.DOC_ID, d.SOURCE, d.FILE_TYPE, d.STAGE_PATH, d.ADDED_AT,
       COALESCE(MAX(r.PAGE_COUNT), d.GROUND_TRUTH:pages::INT) AS PAGES,
       ARRAY_AGG(DISTINCT r.MODE) WITHIN GROUP (ORDER BY r.MODE) AS MODES_PARSED,
       MAX(r.FINISHED_AT) AS LAST_PARSED_AT,
       d.GROUND_TRUTH IS NOT NULL AS HAS_GROUND_TRUTH
FROM DOCUMENTS d
LEFT JOIN LATEST_RUNS r ON r.DOC_ID = d.DOC_ID AND r.ERROR IS NULL
WHERE d.SOURCE <> 'fixture'
GROUP BY d.DOC_ID, d.SOURCE, d.FILE_TYPE, d.STAGE_PATH, d.ADDED_AT, d.GROUND_TRUTH;

-- GET_DOCUMENT_FILE: the Document's bytes for the in-browser viewer, as base64 JSON.
-- The App Runtime container has no egress to cloud storage, so presigned URLs and
-- client-side GET are not options; the file is read inside Snowflake instead.
-- Returns NULL for an unknown Document. Paths come from DOCUMENTS, never from the caller.
CREATE OR REPLACE PROCEDURE GET_DOCUMENT_FILE(P_DOC_ID STRING)
RETURNS STRING
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'get_document_file'
EXECUTE AS OWNER
AS
$$
import base64
import json

from snowflake.snowpark.files import SnowflakeFile

CONTENT_TYPES = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                 "tif": "image/tiff", "tiff": "image/tiff",
                 "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


def get_document_file(session, doc_id):
    rows = session.sql("SELECT STAGE_PATH, FILE_TYPE FROM DOCUMENTS WHERE DOC_ID = ?", [doc_id]).collect()
    if not rows:
        return None
    url = session.sql("SELECT BUILD_SCOPED_FILE_URL(@SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCS, ?)",
                      [rows[0]["STAGE_PATH"]]).collect()[0][0]
    with SnowflakeFile.open(url, "rb") as f:
        data = f.read()
    return json.dumps({"base64": base64.b64encode(data).decode("ascii"),
                       "content_type": CONTENT_TYPES.get(rows[0]["FILE_TYPE"], "application/octet-stream"),
                       "bytes": len(data)})
$$;


-- DOCUMENT_FILES: each Document's bytes, read from the stage once and served by plain SELECT.
-- Calling a Python procedure per page view cost 5-9 s (sandbox start), measured 2026-10-30;
-- a SELECT on this table takes well under a second. MATERIALIZE_DOCUMENT_FILES runs after
-- registering the Corpus and after each upload; it skips files whose stage MD5 is unchanged.
CREATE TABLE IF NOT EXISTS DOCUMENT_FILES (
  DOC_ID          STRING PRIMARY KEY,
  CONTENT         BINARY(16777216),  -- explicit: this account's BINARY default is 8 MB; uploads go to 10 MB
  CONTENT_TYPE    STRING,
  BYTES           NUMBER,
  SHA256          STRING,
  STAGE_MD5       STRING,
  MATERIALIZED_AT TIMESTAMP_LTZ
);

CREATE OR REPLACE PROCEDURE MATERIALIZE_DOCUMENT_FILES()
RETURNS STRING
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
HANDLER = 'materialize'
EXECUTE AS OWNER
AS
$$
import base64
import hashlib

from snowflake.snowpark.files import SnowflakeFile

CONTENT_TYPES = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                 "tif": "image/tiff", "tiff": "image/tiff",
                 "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


def materialize(session):
    session.sql("ALTER STAGE SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCS REFRESH").collect()
    todo = session.sql("""
        SELECT d.DOC_ID, d.STAGE_PATH, d.FILE_TYPE, s.MD5
        FROM DOCUMENTS d
        JOIN DIRECTORY(@SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCS) s ON s.RELATIVE_PATH = d.STAGE_PATH
        LEFT JOIN DOCUMENT_FILES f ON f.DOC_ID = d.DOC_ID
        WHERE f.DOC_ID IS NULL OR f.STAGE_MD5 IS DISTINCT FROM s.MD5""").collect()
    for row in todo:
        url = session.sql("SELECT BUILD_SCOPED_FILE_URL(@SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCS, ?)",
                          [row["STAGE_PATH"]]).collect()[0][0]
        with SnowflakeFile.open(url, "rb") as f:
            data = f.read()
        session.sql("""
            MERGE INTO DOCUMENT_FILES t
            USING (SELECT ? AS DOC_ID, TO_BINARY(?, 'BASE64') AS CONTENT, ? AS CONTENT_TYPE,
                          ? AS BYTES, ? AS SHA256, ? AS STAGE_MD5) s
            ON t.DOC_ID = s.DOC_ID
            WHEN MATCHED THEN UPDATE SET CONTENT = s.CONTENT, CONTENT_TYPE = s.CONTENT_TYPE, BYTES = s.BYTES,
                 SHA256 = s.SHA256, STAGE_MD5 = s.STAGE_MD5, MATERIALIZED_AT = CURRENT_TIMESTAMP()
            WHEN NOT MATCHED THEN INSERT (DOC_ID, CONTENT, CONTENT_TYPE, BYTES, SHA256, STAGE_MD5, MATERIALIZED_AT)
                 VALUES (s.DOC_ID, s.CONTENT, s.CONTENT_TYPE, s.BYTES, s.SHA256, s.STAGE_MD5, CURRENT_TIMESTAMP())""",
            [row["DOC_ID"], base64.b64encode(data).decode("ascii"),
             CONTENT_TYPES.get(row["FILE_TYPE"], "application/octet-stream"),
             len(data), hashlib.sha256(data).hexdigest(), row["MD5"]]).collect()
    return f"{len(todo)} materialized"
$$;
