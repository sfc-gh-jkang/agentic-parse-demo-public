"""COMPARE_MODES fairness: crafted Parse Runs that try to score without understanding.

Live (LIVE=1), no billing: registers a fixture Document and inserts hand-written
PARSE_RUNS rows, then scores them through the real COMPARE_MODES procedure.
Each case reproduces a loophole found in the Stage 2 spec review.
"""
import json

import pytest

pytestmark = pytest.mark.live

DOC = "zz_fairness_fixture"
TRUTH = {"doc_id": DOC, "pages": 2, "visuals": [
    {"page": 0, "channel": "image", "image_type": "chart", "chart_type": "bar", "title": "Units by Quarter",
     "bbox": {"top_left_x": 0.1, "top_left_y": 0.1, "bottom_right_x": 0.5, "bottom_right_y": 0.5},
     "series": [{"points": [{"x": "Q1", "y": 12}, {"x": "Q2", "y": 15.1}, {"x": "Q3", "y": 13.8}]}]},
    {"page": 1, "channel": "text", "image_type": "document_page", "approved_on": "2026-09-16"},
]}


def _page(index, content, images=()):
    return {"index": index, "content": content, "dimensions": {"width": 1000, "height": 1000},
            "images": list(images)}


def _chart(results, box=(100, 100, 500, 500)):
    return {"id": "img-0.jpeg", "top_left_x": box[0], "top_left_y": box[1],
            "bottom_right_x": box[2], "bottom_right_y": box[3], "results": results}


@pytest.fixture(scope="module")
def run(cur):
    cur.execute("DELETE FROM PARSE_RUNS WHERE DOC_ID = %s", (DOC,))
    cur.execute("DELETE FROM DOCUMENTS WHERE DOC_ID = %s", (DOC,))
    cur.execute("INSERT INTO DOCUMENTS (DOC_ID, STAGE_PATH, SOURCE, FILE_TYPE, GROUND_TRUTH) "
                "SELECT %s, 'fixture/none.pdf', 'fixture', 'pdf', PARSE_JSON(%s)", (DOC, json.dumps(TRUTH)))

    def put(mode, pages):
        result = {"error": None, "metadata": {"pageCount": 2}, "value": {"pages": pages}}
        cur.execute("DELETE FROM PARSE_RUNS WHERE DOC_ID = %s AND MODE = %s", (DOC, mode))
        cur.execute("INSERT INTO PARSE_RUNS (DOC_ID, MODE, RESULT, PAGE_COUNT, STARTED_AT, FINISHED_AT) "
                    "SELECT %s, %s, PARSE_JSON(%s), 2, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()",
                    (DOC, mode, json.dumps(result)))
        cur.execute("CALL COMPARE_MODES(%s)", (DOC,))
        cols = [c[0] for c in cur.description]
        row = {r[0]: dict(zip(cols, r)) for r in cur.fetchall()}[mode]
        row["MISSED"] = json.loads(row["MISSED"]) if isinstance(row["MISSED"], str) else row["MISSED"]
        return row

    yield put
    cur.execute("DELETE FROM PARSE_RUNS WHERE DOC_ID = %s", (DOC,))
    cur.execute("DELETE FROM DOCUMENTS WHERE DOC_ID = %s", (DOC,))


def _missed(row):
    return [f["fact"] for f in row["MISSED"]["facts"]]


def test_correctly_paired_chart_points_score_every_relation(run):
    points = [{"label": "Q1", "value": 12}, {"label": "Q2", "value": 15.1}, {"label": "Q3", "value": 13.8}]
    row = run("AGENTIC", [_page(0, "![img-0.jpeg](img-0.jpeg)", [_chart(
        {"image_type": "chart", "summary": "Units by quarter.",
         "details": {"chart_type": "bar", "title": "Units by Quarter", "series": [{"points": points}]}})]),
        _page(1, "Approved 2026-09-16")])
    assert row["RELATIONS_FOUND"] == row["RELATIONS"] == 3


def test_flat_object_holding_every_value_does_not_pair_them(run):
    # All values present, but nothing says which quarter has which value.
    row = run("AGENTIC", [_page(0, "", [_chart(
        {"image_type": "chart", "details": {"a": "Q1", "b": "Q2", "c": "Q3", "d": 12, "e": 13.8, "f": 15.1}})]),
        _page(1, "")])
    assert row["RELATIONS_FOUND"] == 0


def test_summary_prose_is_not_a_relation(run):
    row = run("AGENTIC", [_page(0, "", [_chart(
        {"image_type": "chart", "summary": "Q3 dipped below Q2 while Q1 sat at 12 and later 13.8 and 15.1."})]),
        _page(1, "")])
    assert row["RELATIONS_FOUND"] == 0


def test_far_apart_values_on_one_line_do_not_pair(run):
    row = run("OCR", [_page(0, "Q1 Q2 Q3 quarterly units shown in the chart below are 12 15.1 13.8"),
                      _page(1, "")])
    assert row["RELATIONS_FOUND"] == 0


def test_adjacent_label_and_value_on_a_line_pair(run):
    row = run("OCR", [_page(0, "Q1 12\nQ2 15.1\nQ3 13.8"), _page(1, "")])
    assert row["RELATIONS_FOUND"] == 3


def test_json_key_names_do_not_count_as_recovered_text(run):
    # "units by quarter" appears only as a key, never as a value.
    row = run("AGENTIC", [_page(0, "", [_chart({"image_type": "chart", "details": {"units by quarter": 1}})]),
                          _page(1, "")])
    assert "Units by Quarter" in _missed(row)  # shown as the Ground Truth wrote it


def test_fact_on_the_wrong_page_is_not_recovered(run):
    row = run("LAYOUT", [_page(0, "Approved 2026-09-16"), _page(1, "Approval pending")])
    assert "2026-09-16" in _missed(row)


def test_dates_do_not_supply_numbers(run):
    # Guard: 2026-09-12 must not yield 12 for the Q1 = 12 point. (The pre-review scorer
    # also passed this, because it read the parts as negative numbers, -9 and -12.)
    row = run("OCR", [_page(0, "Printed 2026-09-12"), _page(1, "")])
    assert "12" in _missed(row)


def test_whole_number_truth_needs_the_exact_number(run):
    row = run("OCR", [_page(0, "12.4"), _page(1, "")])
    assert "12" in _missed(row)


def test_per_visual_matches_report_field_accuracy(run):
    points = [{"label": "Q1", "value": 12}, {"label": "Q2", "value": 15.1}, {"label": "Q3", "value": 99}]
    row = run("AGENTIC", [_page(0, "", [_chart({"image_type": "chart",
                                               "details": {"title": "Units by Quarter",
                                                           "series": [{"points": points}]}})]),
                          _page(1, "")])
    matches = json.loads(row["MATCHES"]) if isinstance(row["MATCHES"], str) else row["MATCHES"]
    (m,) = matches
    assert m["visual_id"] == "img-0.jpeg" and m["title"] == "Units by Quarter"
    assert "13.8" in m["missed"] and "15.1" not in m["missed"]
