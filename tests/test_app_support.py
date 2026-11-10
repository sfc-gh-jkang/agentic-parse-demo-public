"""App support seam: procedures the web app calls to read Documents.

Live (LIVE=1). No billing: reads stored files and Parse Runs only.
"""
import base64
import hashlib
import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.live
CORPUS = Path(__file__).resolve().parent.parent / "corpus"


def _file(cur, doc_id):
    r = json.loads(cur.execute("CALL GET_DOCUMENT_FILE(%s)", (doc_id,)).fetchone()[0])
    return r["base64"], r["content_type"]


def test_document_file_round_trips_byte_for_byte(cur):
    for doc_id, name in [("quarterly_report", "quarterly_report.pdf"), ("receipt_photo", "receipt_photo.jpg")]:
        b64, _ = _file(cur, doc_id)
        assert hashlib.sha256(base64.b64decode(b64)).digest() == \
            hashlib.sha256((CORPUS / name).read_bytes()).digest(), doc_id


def test_document_file_reports_content_type(cur):
    assert _file(cur, "quarterly_report")[1] == "application/pdf"
    assert _file(cur, "receipt_photo")[1] == "image/jpeg"
    assert _file(cur, "whiteboard_photo")[1] == "image/png"


def test_unknown_document_returns_null_not_a_stage_read(cur):
    assert cur.execute("CALL GET_DOCUMENT_FILE('no_such_doc')").fetchone()[0] is None


def test_document_catalog_lists_corpus_with_latest_run_per_mode(cur):
    cur.execute("SELECT DOC_ID, PAGES, MODES_PARSED FROM DOCUMENT_CATALOG WHERE DOC_ID = 'quarterly_report'")
    doc_id, pages, modes = cur.fetchone()
    assert pages == 2
    assert sorted(json.loads(modes)) == ["AGENTIC", "LAYOUT", "OCR"]
    assert cur.execute("SELECT COUNT(*) FROM DOCUMENT_CATALOG WHERE SOURCE = 'fixture'").fetchone()[0] == 0


def test_document_bytes_are_materialized_once_for_fast_reads(cur):
    # The viewer reads bytes with a plain SELECT (no Python sandbox start per view).
    cur.execute("CALL MATERIALIZE_DOCUMENT_FILES()")
    cur.execute("SELECT CONTENT_TYPE, BYTES, SHA256 FROM DOCUMENT_FILES WHERE DOC_ID = 'quarterly_report'")
    content_type, size, sha = cur.fetchone()
    local = (CORPUS / "quarterly_report.pdf").read_bytes()
    assert (content_type, size, sha) == ("application/pdf", len(local), hashlib.sha256(local).hexdigest())
    n_docs = cur.execute("SELECT COUNT(*) FROM DOCUMENTS WHERE SOURCE = 'corpus'").fetchone()[0]
    assert cur.execute("SELECT COUNT(*) FROM DOCUMENT_FILES").fetchone()[0] >= n_docs


def test_materialized_bytes_round_trip(cur):
    cur.execute("SELECT BASE64_ENCODE(CONTENT) FROM DOCUMENT_FILES WHERE DOC_ID = 'receipt_photo'")
    data = base64.b64decode(cur.fetchone()[0].replace("\n", ""))
    assert data == (CORPUS / "receipt_photo.jpg").read_bytes()


def test_rematerializing_skips_unchanged_documents(cur):
    first = cur.execute("SELECT MAX(MATERIALIZED_AT) FROM DOCUMENT_FILES").fetchone()[0]
    cur.execute("CALL MATERIALIZE_DOCUMENT_FILES()")
    assert cur.fetchone()[0].startswith("0 ")  # "0 materialized"
    assert cur.execute("SELECT MAX(MATERIALIZED_AT) FROM DOCUMENT_FILES").fetchone()[0] == first


def test_mode_comparisons_are_stored_for_fast_reads(cur):
    # COMPARE_MODES is a Python procedure (seconds per call); the viewer reads stored scores instead.
    cur.execute("CALL REFRESH_MODE_COMPARISONS(NULL)")
    cur.execute("SELECT MODE, RELATIONS, RELATIONS_FOUND, VISUALS_DETECTED, RUN_ID FROM MODE_COMPARISONS "
                "WHERE DOC_ID = 'quarterly_report' ORDER BY MODE")
    rows = {r[0]: r for r in cur.fetchall()}
    assert set(rows) == {"AGENTIC", "LAYOUT", "OCR"}
    assert rows["AGENTIC"][2] == rows["AGENTIC"][1] == 13      # all 13 chart points paired
    assert rows["AGENTIC"][3] == 3                               # all 3 charts detected
    latest = dict(cur.execute("SELECT MODE, RUN_ID FROM LATEST_RUNS WHERE DOC_ID = 'quarterly_report'").fetchall())
    assert {m: r[4] for m, r in rows.items()} == latest          # scored against the latest Parse Runs


def test_refresh_skips_documents_whose_latest_runs_are_already_scored(cur):
    cur.execute("CALL REFRESH_MODE_COMPARISONS(NULL)")
    assert cur.fetchone()[0].startswith("0 ")                   # "0 documents rescored"
