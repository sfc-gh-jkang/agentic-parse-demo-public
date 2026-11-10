-- COMPARE_MODES(doc_id): score each Parse Mode's latest stored Parse Run against Ground Truth.
-- Scoring logic lives in scoring/score.py, uploaded to @CODE by scripts/deploy.sh.
USE ROLE AGENTIC_PARSE_DEMO_RL;
USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_WH;
USE SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO;

CREATE OR REPLACE PROCEDURE COMPARE_MODES(P_DOC_ID STRING)
RETURNS TABLE (MODE STRING, RUN_ID STRING, FINISHED_AT TIMESTAMP_LTZ,
               IMAGE_FACTS INT, IMAGE_FACTS_FOUND INT, TEXT_FACTS INT, TEXT_FACTS_FOUND INT,
               RELATIONS INT, RELATIONS_FOUND INT, VISUALS_EXPECTED INT, VISUALS_DETECTED INT,
               CHARS INT, TABLES INT, MATCHES VARIANT, MISSED VARIANT)
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
IMPORTS = ('@SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.CODE/score.py',
           '@SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.CODE/compare_proc.py')
HANDLER = 'compare_modes'
EXECUTE AS OWNER
AS
$$
from compare_proc import COUNT_COLUMNS, score_document
from snowflake.snowpark.types import (IntegerType, StringType, StructField, StructType,
                                      TimestampTimeZone, TimestampType, VariantType)

SCHEMA = StructType([
    StructField("MODE", StringType()), StructField("RUN_ID", StringType()),
    StructField("FINISHED_AT", TimestampType(TimestampTimeZone.LTZ)),
    *[StructField(c, IntegerType()) for c in COUNT_COLUMNS],
    StructField("MATCHES", VariantType()), StructField("MISSED", VariantType()),
])


def compare_modes(session, doc_id):
    rows = [(r["MODE"], r["RUN_ID"], r["FINISHED_AT"], *[r[c] for c in COUNT_COLUMNS], r["MATCHES"], r["MISSED"])
            for r in score_document(session, doc_id)]
    return session.create_dataframe(rows, schema=SCHEMA)
$$;

-- MODE_COMPARISONS: COMPARE_MODES results stored per Document and Parse Mode, so the app
-- reads scores with a plain SELECT instead of starting a Python procedure per page view.
CREATE TABLE IF NOT EXISTS MODE_COMPARISONS (
  DOC_ID STRING, MODE STRING, RUN_ID STRING, FINISHED_AT TIMESTAMP_LTZ,
  IMAGE_FACTS INT, IMAGE_FACTS_FOUND INT, TEXT_FACTS INT, TEXT_FACTS_FOUND INT,
  RELATIONS INT, RELATIONS_FOUND INT, VISUALS_EXPECTED INT, VISUALS_DETECTED INT,
  CHARS INT, TABLES INT, MATCHES VARIANT, MISSED VARIANT, SCORED_AT TIMESTAMP_LTZ,
  PRIMARY KEY (DOC_ID, MODE)
);

-- REFRESH_MODE_COMPARISONS(doc_id or NULL): rescore Documents whose latest Parse Runs are
-- not the ones already scored. Call after PARSE_DOCUMENT (upload, Run button) or a scorer change
-- (TRUNCATE MODE_COMPARISONS first to force a full rescore).
CREATE OR REPLACE PROCEDURE REFRESH_MODE_COMPARISONS(P_DOC_ID STRING)
RETURNS STRING
LANGUAGE PYTHON
RUNTIME_VERSION = '3.12'
PACKAGES = ('snowflake-snowpark-python')
IMPORTS = ('@SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.CODE/score.py',
           '@SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.CODE/compare_proc.py')
HANDLER = 'refresh'
EXECUTE AS OWNER
AS
$$
import json

from compare_proc import COUNT_COLUMNS, score_document


def refresh(session, doc_id):
    # A bound Python None does not behave as SQL NULL in "? IS NULL", so filter in Python.
    one_doc = " AND l.DOC_ID = ?" if doc_id is not None else ""
    stale = [r["DOC_ID"] for r in session.sql(f"""
        SELECT DISTINCT l.DOC_ID
        FROM LATEST_RUNS l JOIN DOCUMENTS d USING (DOC_ID)
        LEFT JOIN MODE_COMPARISONS c ON c.DOC_ID = l.DOC_ID AND c.MODE = l.MODE
        WHERE l.ERROR IS NULL AND d.GROUND_TRUTH IS NOT NULL AND d.SOURCE <> 'fixture'
          AND c.RUN_ID IS DISTINCT FROM l.RUN_ID{one_doc}""", [doc_id] if doc_id is not None else []).collect()]
    cols = ", ".join(COUNT_COLUMNS)
    for d in stale:
        session.sql("DELETE FROM MODE_COMPARISONS WHERE DOC_ID = ?", [d]).collect()
        for r in score_document(session, d):
            session.sql(
                f"INSERT INTO MODE_COMPARISONS (DOC_ID, MODE, RUN_ID, FINISHED_AT, {cols}, MATCHES, MISSED, SCORED_AT) "
                f"SELECT ?, ?, ?, ?, {', '.join('?' for _ in COUNT_COLUMNS)}, PARSE_JSON(?), PARSE_JSON(?), "
                "CURRENT_TIMESTAMP()",
                [d, r["MODE"], r["RUN_ID"], r["FINISHED_AT"], *[r[c] for c in COUNT_COLUMNS],
                 json.dumps(r["MATCHES"]), json.dumps(r["MISSED"])]).collect()
    return f"{len(stale)} documents rescored"
$$;
