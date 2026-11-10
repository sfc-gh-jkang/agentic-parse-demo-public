"""COMPARE_MODES seam: per-Parse-Mode recovery of Ground Truth facts and Visuals.

Live (LIVE=1). Reads the stored latest Parse Runs; never re-parses.
Expected outcomes are literals about what is visibly drawn in each Document.
"""
import json

import pytest

pytestmark = pytest.mark.live


def _compare(cur, doc_id):
    cur.execute("CALL COMPARE_MODES(%s)", (doc_id,))
    cols = [c[0] for c in cur.description]
    rows = {r[cols.index("MODE")]: dict(zip(cols, r)) for r in cur.fetchall()}
    for r in rows.values():
        r["MISSED"] = json.loads(r["MISSED"]) if isinstance(r["MISSED"], str) else r["MISSED"]
    return rows


def test_one_row_per_parse_mode(cur):
    assert set(_compare(cur, "quarterly_report")) == {"OCR", "LAYOUT", "AGENTIC"}


def test_control_contract_has_no_image_facts_and_every_mode_reads_the_text(cur):
    rows = _compare(cur, "control_contract")
    for mode, r in rows.items():
        assert r["IMAGE_FACTS"] == 0, mode
        assert r["VISUALS_EXPECTED"] == 0, mode
        assert r["TEXT_FACTS"] > 0
        assert r["TEXT_FACTS_FOUND"] == r["TEXT_FACTS"], (mode, r["MISSED"])


def test_line_chart_points_are_only_recovered_by_agentic(cur):
    # The Active Customers line chart has no data labels drawn; only reading the
    # plotted line recovers Feb = 1905.
    rows = _compare(cur, "quarterly_report")
    assert "1905" not in json.dumps(rows["AGENTIC"]["MISSED"])
    assert "1905" in json.dumps(rows["OCR"]["MISSED"])


def test_agentic_detects_all_three_charts(cur):
    r = _compare(cur, "quarterly_report")["AGENTIC"]
    assert (r["VISUALS_EXPECTED"], r["VISUALS_DETECTED"]) == (3, 3)


def test_text_modes_detect_no_visuals(cur):
    rows = _compare(cur, "quarterly_report")
    assert rows["OCR"]["VISUALS_DETECTED"] == rows["LAYOUT"]["VISUALS_DETECTED"] == 0


def test_agentic_recovers_more_relations_than_ocr_on_visual_documents(cur):
    # OCR reads the words printed on a chart or diagram but not what goes with what.
    for doc in ["quarterly_report", "floor_plan_diagram", "whiteboard_photo"]:
        rows = _compare(cur, doc)
        assert rows["AGENTIC"]["RELATIONS_FOUND"] > rows["OCR"]["RELATIONS_FOUND"], doc


def test_whiteboard_edges_are_recovered_by_agentic(cur):
    missed = json.dumps(_compare(cur, "whiteboard_photo")["AGENTIC"]["MISSED"])
    assert "Parse | Search" not in missed.replace("parse", "Parse").replace("search", "Search")


def test_two_column_checklist_states_are_read_per_box(cur):
    # The inspection checklist is drawn as an image in two columns; AGENTIC writes
    # "| ☐ Gasket intact | ☑ Labels legible |". Each label owns the marker before it.
    missed = json.dumps(_compare(cur, "inspection_form")["AGENTIC"]["MISSED"]["facts"])
    for label in ["Gasket intact", "No visible corrosion", "Guard in place", "Labels legible"]:
        assert label not in missed, label


def test_whole_page_scans_are_not_counted_as_missed_visuals(cur):
    r = _compare(cur, "scanned_contract")["AGENTIC"]
    assert r["VISUALS_EXPECTED"] == 0
    assert r["IMAGE_FACTS_FOUND"] == r["IMAGE_FACTS"], r["MISSED"]
