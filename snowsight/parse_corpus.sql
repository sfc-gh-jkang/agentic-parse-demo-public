-- Agentic Parse Demo: parse the Corpus in OCR, LAYOUT and AGENTIC (BILLED, per page).
-- The Corpus is 22 pages. Measured on the author's demo account, Oct 2026, in AI credits per 1,000 pages:
-- OCR 0.68, LAYOUT 3.66, AGENTIC 8.18, so about 0.28 AI credits for all three modes. Your rates may differ.
-- Pairs that already have a successful Parse Run are skipped, so a re-run costs nothing.
-- Runs one parse at a time (about 5 to 20 s each); ./setup.sh runs six in parallel.
USE ROLE AGENTIC_PARSE_DEMO_RL;
USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_WH;
USE SCHEMA SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO;
EXECUTE IMMEDIATE $$
DECLARE
  n INTEGER DEFAULT 0;
  c CURSOR FOR
    SELECT d.DOC_ID, m.VALUE::STRING AS MODE
    FROM DOCUMENTS d, TABLE(FLATTEN(ARRAY_CONSTRUCT('OCR', 'LAYOUT', 'AGENTIC'))) m
    WHERE d.SOURCE = 'corpus'
      AND NOT EXISTS (SELECT 1 FROM PARSE_RUNS r WHERE r.DOC_ID = d.DOC_ID AND r.MODE = m.VALUE::STRING AND r.ERROR IS NULL)
    ORDER BY 1, 2;
BEGIN
  FOR rec IN c DO
    LET doc STRING := rec.DOC_ID;
    LET md STRING := rec.MODE;
    CALL PARSE_DOCUMENT(:doc, :md);
    n := n + 1;
  END FOR;
  RETURN n || ' parses run';
END;
$$;
-- Score every Document against its Ground Truth, then refresh search over the parsed text.
DELETE FROM MODE_COMPARISONS;
CALL REFRESH_MODE_COMPARISONS(NULL);
ALTER CORTEX SEARCH SERVICE PARSED_DOCS_SEARCH REFRESH;
SELECT MODE, COUNT(*) AS RUNS FROM PARSE_RUNS WHERE ERROR IS NULL GROUP BY MODE ORDER BY MODE;
