-- Upload + app-triggered parsing (T8). Upload limits are enforced here, server-side. Both procedures run as owner.
USE ROLE AGENTIC_PARSE_DEMO_RL;
USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_WH;
USE SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO;

-- 'script' = corpus load / tests; 'app' = Upload or Run button.
-- IF NOT EXISTS errors ("ambiguous column name") when the column already exists, so check first.
EXECUTE IMMEDIATE $$
BEGIN
  IF (NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'AGENTIC_PARSE_DEMO'
                  AND TABLE_NAME = 'PARSE_RUNS' AND COLUMN_NAME = 'TRIGGER_SOURCE')) THEN
    ALTER TABLE PARSE_RUNS ADD COLUMN TRIGGER_SOURCE STRING DEFAULT 'script';
  END IF;
  IF (NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'AGENTIC_PARSE_DEMO'
                  AND TABLE_NAME = 'DOCUMENTS' AND COLUMN_NAME = 'PAGES')) THEN
    ALTER TABLE DOCUMENTS ADD COLUMN PAGES NUMBER;
  END IF;
END;
$$;

-- LATEST_RUNS is SELECT *, which a view freezes at creation: recreate it to pick up TRIGGER_SOURCE.
CREATE OR REPLACE VIEW LATEST_RUNS AS
SELECT * FROM PARSE_RUNS
QUALIFY ROW_NUMBER() OVER (PARTITION BY DOC_ID, MODE ORDER BY FINISHED_AT DESC, RUN_ID DESC) = 1;

CREATE OR REPLACE VIEW DOCUMENT_CATALOG AS
SELECT d.DOC_ID, d.SOURCE, d.FILE_TYPE, d.STAGE_PATH, d.ADDED_AT,
       COALESCE(MAX(r.PAGE_COUNT), d.PAGES, d.GROUND_TRUTH:pages::INT) AS PAGES,
       ARRAY_AGG(DISTINCT r.MODE) WITHIN GROUP (ORDER BY r.MODE) AS MODES_PARSED,
       MAX(r.FINISHED_AT) AS LAST_PARSED_AT,
       d.GROUND_TRUTH IS NOT NULL AS HAS_GROUND_TRUTH
FROM DOCUMENTS d
LEFT JOIN LATEST_RUNS r ON r.DOC_ID = d.DOC_ID AND r.ERROR IS NULL
WHERE d.SOURCE <> 'fixture'
GROUP BY d.DOC_ID, d.SOURCE, d.FILE_TYPE, d.STAGE_PATH, d.ADDED_AT, d.PAGES, d.GROUND_TRUTH;

-- UPLOAD_DOCUMENT: validate (extension, magic bytes, size, pages), store, register.
-- Limits: pdf/png/jpg/jpeg/tif/tiff/docx/pptx, 10 MB, 20 pages (PDF via pypdf, PPTX slides via
-- python-pptx, images 1; DOCX has no reliable page count so it is capped by size only).
-- The filename never reaches a path: the stored name is up_<slug>_<6 hex>.<ext>.
-- One-time migration: DOCUMENT_FILES.CONTENT was created at the 8 MB BINARY default, which
-- rejected uploads between 8 and 10 MB ("Binary value ... is too long and would be truncated").
-- BINARY length cannot be altered in place, so rebuild and swap. No-op once widened.
EXECUTE IMMEDIATE $$
DECLARE
  col_type STRING;
BEGIN
  -- INFORMATION_SCHEMA reports NULL length for BINARY columns; DESCRIBE shows e.g. BINARY(8388608).
  DESCRIBE TABLE SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCUMENT_FILES;
  SELECT "type" INTO :col_type FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) WHERE "name" = 'CONTENT';
  IF (col_type <> 'BINARY(16777216)') THEN
    CREATE OR REPLACE TABLE DOCUMENT_FILES_WIDE (
      DOC_ID STRING PRIMARY KEY, CONTENT BINARY(16777216), CONTENT_TYPE STRING, BYTES NUMBER,
      SHA256 STRING, STAGE_MD5 STRING, MATERIALIZED_AT TIMESTAMP_LTZ);
    INSERT INTO DOCUMENT_FILES_WIDE SELECT DOC_ID, CONTENT, CONTENT_TYPE, BYTES, SHA256, STAGE_MD5, MATERIALIZED_AT
      FROM DOCUMENT_FILES;
    ALTER TABLE DOCUMENT_FILES SWAP WITH DOCUMENT_FILES_WIDE;
    DROP TABLE DOCUMENT_FILES_WIDE;
    RETURN 'DOCUMENT_FILES.CONTENT widened to 16 MB';
  END IF;
  RETURN 'DOCUMENT_FILES.CONTENT already 16 MB';
END;
$$;

CREATE OR REPLACE PROCEDURE UPLOAD_DOCUMENT(P_FILENAME STRING, P_CONTENT_BASE64 STRING)
RETURNS STRING
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python', 'pypdf', 'python-pptx', 'pillow')
HANDLER = 'upload'
EXECUTE AS OWNER
AS
$$
import base64
import hashlib
import io
import json
import re
import secrets

MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 20
STAGE = "@SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCS"
CONTENT_TYPES = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                 "tif": "image/tiff", "tiff": "image/tiff",
                 "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}


def _fail(msg):
    return json.dumps({"ok": False, "error": msg})


def _magic_ok(ext, data):
    if ext == "pdf":
        return data[:5] == b"%PDF-"
    if ext == "png":
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    if ext in ("jpg", "jpeg"):
        return data[:3] == b"\xff\xd8\xff"
    if ext in ("tif", "tiff"):
        return data[:4] in (b"II*\x00", b"MM\x00*")
    return data[:2] == b"PK"


def _docx_pages(data):
    """DOCX stores no reliable page count. Return a lower bound only when the file proves more than one
    page (explicit page breaks, or Word's docProps/app.xml Pages), else None, so the 20-page limit still
    applies to long documents without inventing a count for short ones."""
    import zipfile
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        doc = z.read("word/document.xml").decode("utf-8", "replace")
        app = z.read("docProps/app.xml").decode("utf-8", "replace") if "docProps/app.xml" in z.namelist() else ""
    breaks = len(re.findall(r'<w:br\b[^>]*w:type="page"', doc))
    stated = re.search(r"<Pages>(\d+)</Pages>", app)
    n = max(breaks + 1 if breaks else 0, int(stated.group(1)) if stated else 0)
    return n if n > 1 else None


def _pages(ext, data):
    if ext == "pdf":
        from pypdf import PdfReader
        return len(PdfReader(io.BytesIO(data)).pages)
    if ext == "pptx":
        from pptx import Presentation
        return len(Presentation(io.BytesIO(data)).slides)
    if ext == "docx":
        return _docx_pages(data)
    # Valid magic bytes are not enough: a truncated image must still decode.
    from PIL import Image
    Image.open(io.BytesIO(data)).verify()
    Image.open(io.BytesIO(data)).load()
    return 1


def upload(session, filename, content_b64):
    name = (filename or "").replace("\\", "/").split("/")[-1]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in CONTENT_TYPES:
        return _fail("Unsupported file type. Use PDF, PPTX, DOCX, PNG, JPG or TIFF.")
    if not content_b64:
        return _fail("The file is empty.")
    if len(content_b64) * 3 // 4 > MAX_BYTES + 4:
        return _fail("File is larger than the 10 MB limit.")
    try:
        data = base64.b64decode(content_b64, validate=False)
    except Exception:
        return _fail("The file content could not be read.")
    if len(data) > MAX_BYTES:
        return _fail("File is larger than the 10 MB limit.")
    if len(data) == 0:
        return _fail("The file is empty.")
    if not _magic_ok(ext, data):
        return _fail(f"File content does not look like a .{ext} file.")
    try:
        pages = _pages(ext, data)
    except Exception:
        return _fail(f"The .{ext} file could not be opened. It may be corrupt or password protected.")
    if pages is not None and pages > MAX_PAGES:
        return _fail(f"Document has {pages} pages; the limit is {MAX_PAGES} pages.")
    if ext == "docx":
        pages = None  # the DOCX count is only a lower bound for the limit; PAGES stays NULL (README)

    stem = name.rsplit(".", 1)[0] if "." in name else name
    slug = re.sub(r"[^a-z0-9_]+", "_", stem.lower()).strip("_")[:40] or "document"
    doc_id = f"up_{slug}_{secrets.token_hex(3)}"
    rel = f"uploads/{doc_id}.{ext}"
    # Snowpark binds Python None as the string 'None', so an unknown page count travels as -1.
    # Rows first, stage file last: REMOVE is not allowed inside a stored procedure, so a failure
    # must never happen after the file is written. Deleting the rows is the whole rollback.
    try:
        session.sql("INSERT INTO DOCUMENTS (DOC_ID, STAGE_PATH, SOURCE, FILE_TYPE, GROUND_TRUTH, PAGES) "
                    "SELECT ?, ?, 'upload', ?, NULL, NULLIF(?, -1)", [doc_id, rel, ext, -1 if pages is None else pages]).collect()
        session.sql("INSERT INTO DOCUMENT_FILES (DOC_ID, CONTENT, CONTENT_TYPE, BYTES, SHA256, STAGE_MD5, MATERIALIZED_AT) "
                    "SELECT ?, TO_BINARY(?, 'BASE64'), ?, ?, ?, NULL, CURRENT_TIMESTAMP()",
                    [doc_id, base64.b64encode(data).decode("ascii"), CONTENT_TYPES[ext], len(data),
                     hashlib.sha256(data).hexdigest()]).collect()
        session.file.put_stream(io.BytesIO(data), f"{STAGE}/{rel}", auto_compress=False, overwrite=False)
    except Exception:
        for table in ("DOCUMENT_FILES", "DOCUMENTS"):
            session.sql(f"DELETE FROM {table} WHERE DOC_ID = ?", [doc_id]).collect()
        # The message names internal objects; the caller gets a fixed reason (the query history keeps the detail).
        return json.dumps({"ok": False, "error": "Upload could not be stored. Try again, or reset the demo."})
    # Best effort: record the stage MD5 (MATERIALIZE_DOCUMENT_FILES compares it later).
    session.sql(f"ALTER STAGE {STAGE[1:]} REFRESH").collect()
    session.sql(f"UPDATE DOCUMENT_FILES SET STAGE_MD5 = (SELECT MD5 FROM DIRECTORY({STAGE}) WHERE RELATIVE_PATH = ?) "
                "WHERE DOC_ID = ?", [rel, doc_id]).collect()
    return json.dumps({"ok": True, "doc_id": doc_id, "pages": pages})
$$;

DROP PROCEDURE IF EXISTS APP_PARSE_BUDGET();

-- APP_PARSE: what the app's Upload and Run button call. Spends AI credits (PARSE_DOCUMENT),
-- so granting USAGE on it grants the ability to spend. Tags the run so app runs differ from script runs.
CREATE OR REPLACE PROCEDURE APP_PARSE(P_DOC_ID STRING, P_MODE STRING)
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  v_res STRING;
  v_err STRING;
  v_pages NUMBER;
  v_has_gt BOOLEAN DEFAULT FALSE;
BEGIN
  CALL PARSE_DOCUMENT(:P_DOC_ID, :P_MODE) INTO :v_res;
  IF (STARTSWITH(v_res, 'ERROR')) THEN
    RETURN TO_JSON(OBJECT_CONSTRUCT('ok', FALSE, 'error', :v_res));
  END IF;
  UPDATE PARSE_RUNS SET TRIGGER_SOURCE = 'app' WHERE RUN_ID = :v_res;
  SELECT ERROR, PAGE_COUNT INTO :v_err, :v_pages FROM PARSE_RUNS WHERE RUN_ID = :v_res;
  UPDATE DOCUMENTS SET PAGES = :v_pages WHERE DOC_ID = :P_DOC_ID AND PAGES IS NULL AND :v_pages IS NOT NULL;
  SELECT COALESCE(BOOLOR_AGG(GROUND_TRUTH IS NOT NULL), FALSE) INTO :v_has_gt FROM DOCUMENTS WHERE DOC_ID = :P_DOC_ID;
  IF (v_has_gt AND v_err IS NULL) THEN
    CALL REFRESH_MODE_COMPARISONS(:P_DOC_ID);
  END IF;
  -- Only AGENTIC runs feed SEARCH_CHUNKS; refresh now instead of waiting for TARGET_LAG (1 hour).
  IF (v_err IS NULL AND UPPER(:P_MODE) = 'AGENTIC') THEN
    ALTER CORTEX SEARCH SERVICE PARSED_DOCS_SEARCH REFRESH;
  END IF;
  RETURN TO_JSON(OBJECT_CONSTRUCT_KEEP_NULL('ok', TRUE, 'run_id', :v_res, 'error', :v_err, 'pages', :v_pages));
END;
$$;

-- RESET_DEMO: presenter reset. Deletes every Uploaded Document (rows in all four tables) and
-- refreshes PARSED_DOCS_SEARCH; the Corpus is untouched. REMOVE is rejected inside a stored
-- procedure ("Unsupported statement", tested 2026-11-01), so the caller removes the stage files
-- next: REMOVE @DOCS/uploads/; ALTER STAGE DOCS REFRESH (web/app/api/reset/route.ts does this).
-- Not an agent tool: only the app's confirm dialog calls it.
CREATE OR REPLACE PROCEDURE RESET_DEMO()
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO :n FROM DOCUMENTS WHERE SOURCE = 'upload';
  DELETE FROM MODE_COMPARISONS WHERE DOC_ID IN (SELECT DOC_ID FROM DOCUMENTS WHERE SOURCE = 'upload');
  DELETE FROM PARSE_RUNS WHERE DOC_ID IN (SELECT DOC_ID FROM DOCUMENTS WHERE SOURCE = 'upload');
  DELETE FROM DOCUMENT_FILES WHERE DOC_ID IN (SELECT DOC_ID FROM DOCUMENTS WHERE SOURCE = 'upload');
  DELETE FROM DOCUMENTS WHERE SOURCE = 'upload';
  ALTER CORTEX SEARCH SERVICE PARSED_DOCS_SEARCH REFRESH;
  RETURN OBJECT_CONSTRUCT('ok', TRUE, 'uploads_removed', :n)::STRING;
END;
$$;
