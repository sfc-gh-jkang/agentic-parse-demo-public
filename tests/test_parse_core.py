"""Procedure seam: PARSE_DOCUMENT stores a Parse Run; PARSE_PAGES / PARSE_VISUALS expose it.

Live against the author's demo account (role AGENTIC_PARSE_DEMO_RL). Each run parses the 2-page
quarterly report in OCR and AGENTIC (4 billed pages). Expected values are the
literals drawn by the generator (see corpus/quarterly_report.truth.json).
"""
import pytest

pytestmark = pytest.mark.live


def _one(cur, sql, *args):
    cur.execute(sql, args)
    return cur.fetchone()


@pytest.fixture(scope="module")
def agentic_run(cur):
    run_id = _one(cur, "CALL PARSE_DOCUMENT('quarterly_report', 'AGENTIC')")[0]
    assert not run_id.startswith("ERROR"), run_id
    return run_id


def test_agentic_run_is_stored_without_error(cur, agentic_run):
    mode, err, pages, qid = _one(
        cur, "SELECT MODE, ERROR, PAGE_COUNT, QUERY_ID FROM PARSE_RUNS WHERE RUN_ID = %s", agentic_run)
    assert (mode, err, pages) == ("AGENTIC", None, 2)
    assert qid  # needed to join measured cost


def test_agentic_visuals_are_the_three_charts(cur, agentic_run):
    cur.execute("SELECT PAGE_INDEX, IMAGE_TYPE, DETAILS:chart_type::STRING FROM PARSE_VISUALS "
                "WHERE RUN_ID = %s ORDER BY PAGE_INDEX, X0", (agentic_run,))
    assert cur.fetchall() == [(0, "chart", "bar"), (0, "chart", "line"), (1, "chart", "pie")]


def test_agentic_reads_bar_chart_values(cur, agentic_run):
    cur.execute("SELECT p.value:label::STRING, p.value:value::FLOAT FROM PARSE_VISUALS v, "
                "LATERAL FLATTEN(v.DETAILS:series[0]:points) p "
                "WHERE v.RUN_ID = %s AND v.DETAILS:chart_type = 'bar' ORDER BY p.index", (agentic_run,))
    assert cur.fetchall() == [("Q1", 12.4), ("Q2", 15.1), ("Q3", 13.8), ("Q4", 17.2)]


def test_visual_boxes_are_normalized_and_left_right(cur, agentic_run):
    cur.execute("SELECT X0, Y0, X1, Y1 FROM PARSE_VISUALS WHERE RUN_ID = %s AND PAGE_INDEX = 0 "
                "ORDER BY X0", (agentic_run,))
    bar, line = cur.fetchall()
    assert all(0 <= v <= 1 for v in bar + line)
    assert bar[2] < 0.5 < line[0]  # bar chart in left column, line chart in right


def test_ocr_run_has_text_but_no_visuals(cur):
    run_id = _one(cur, "CALL PARSE_DOCUMENT('quarterly_report', 'OCR')")[0]
    text = " ".join(r[0] for r in cur.execute(
        "SELECT CONTENT FROM PARSE_PAGES WHERE RUN_ID = %s", (run_id,)).fetchall())
    assert "Executive summary" in text
    assert _one(cur, "SELECT COUNT(*) FROM PARSE_VISUALS WHERE RUN_ID = %s", run_id)[0] == 0


def test_rejects_unknown_mode(cur):
    assert _one(cur, "CALL PARSE_DOCUMENT('quarterly_report', 'VISION')")[0].startswith("ERROR")


def test_corpus_is_registered_with_ground_truth(cur):
    n, with_truth = _one(cur, "SELECT COUNT(*), COUNT(GROUND_TRUTH) FROM DOCUMENTS WHERE SOURCE = 'corpus'")
    assert n == with_truth == 11


def test_unknown_document_is_rejected_before_any_parse(cur):
    before = _one(cur, "SELECT COUNT(*) FROM PARSE_RUNS")[0]
    assert _one(cur, "CALL PARSE_DOCUMENT('no_such_doc', 'OCR')")[0] == "ERROR: unknown document no_such_doc"
    assert _one(cur, "SELECT COUNT(*) FROM PARSE_RUNS")[0] == before


def test_layout_run_keeps_markdown_structure_without_visual_details(cur):
    run_id = _one(cur, "CALL PARSE_DOCUMENT('stamped_invoice', 'LAYOUT')")[0]
    text = _one(cur, "SELECT CONTENT FROM PARSE_PAGES WHERE RUN_ID = %s", run_id)[0]
    # invoice table comes back as a markdown table row
    row = next(line for line in text.splitlines() if "Onboarding workshop" in line)
    assert row.strip().startswith("|") and "$850.00" in row
    assert _one(cur, "SELECT COUNT(*) FROM PARSE_VISUALS WHERE RUN_ID = %s", run_id)[0] == 0


# --- Shapes observed live on 2026-10-30 (see docs/parse-output-notes.md) ---

def test_image_file_visuals_come_from_top_level_images(cur):
    # Image files are parsed without page_split, so Visuals arrive in value:images.
    cur.execute("SELECT v.IMAGE_TYPE, v.DETAILS:components FROM PARSE_VISUALS v "
                "JOIN LATEST_RUNS r USING (RUN_ID) WHERE v.DOC_ID = 'whiteboard_photo'")
    rows = cur.fetchall()
    assert len(rows) == 1
    import json
    labels = [c["label"] for c in json.loads(rows[0][1])]
    assert labels == ["Ingest", "Parse", "Search", "Agent"]


def test_other_type_visual_exposes_description_and_visible_text(cur):
    # 'other' Visuals carry description + visible_text instead of summary/details.
    summary, text = _one(cur, "SELECT v.SUMMARY, v.VISIBLE_TEXT FROM PARSE_VISUALS v JOIN LATEST_RUNS r "
                              "USING (RUN_ID) WHERE v.DOC_ID = 'stamped_invoice'")
    assert "PAID" in summary
    assert "PAID" in text
