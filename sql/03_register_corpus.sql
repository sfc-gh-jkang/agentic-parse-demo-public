-- Register the Corpus: one DOCUMENTS row per manifest entry, Ground Truth read from the stage.
-- Idempotent; re-run after regenerating and re-uploading the Corpus.
USE ROLE AGENTIC_PARSE_DEMO_RL;
USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_WH;
USE SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO;

CREATE FILE FORMAT IF NOT EXISTS JSON_WHOLE TYPE = JSON STRIP_OUTER_ARRAY = FALSE;

MERGE INTO DOCUMENTS d
USING (
  SELECT m.value:doc_id::STRING                         AS DOC_ID,
         'corpus/' || m.value:file::STRING              AS STAGE_PATH,
         LOWER(SPLIT_PART(m.value:file::STRING, '.', -1)) AS FILE_TYPE,
         t.$1                                           AS GROUND_TRUTH
  FROM (SELECT $1 AS manifest FROM @DOCS/corpus/manifest.json (FILE_FORMAT => 'JSON_WHOLE')) mf,
       LATERAL FLATTEN(mf.manifest) m
  JOIN (SELECT $1, METADATA$FILENAME AS fname
        FROM @DOCS/corpus/ (FILE_FORMAT => 'JSON_WHOLE', PATTERN => '.*\\.truth\\.json')) t
    ON t.fname = 'corpus/' || m.value:truth_file::STRING
) s
ON d.DOC_ID = s.DOC_ID
WHEN MATCHED THEN UPDATE SET STAGE_PATH = s.STAGE_PATH, FILE_TYPE = s.FILE_TYPE, GROUND_TRUTH = s.GROUND_TRUTH
WHEN NOT MATCHED THEN INSERT (DOC_ID, STAGE_PATH, SOURCE, FILE_TYPE, GROUND_TRUTH)
  VALUES (s.DOC_ID, s.STAGE_PATH, 'corpus', s.FILE_TYPE, s.GROUND_TRUTH);
