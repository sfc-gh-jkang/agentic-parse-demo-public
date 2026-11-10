"""PARSE_COST seam: measured credits per Parse Mode, never estimated.

Live (LIVE=1). The OCR < LAYOUT < AGENTIC ordering was measured on the author's demo account on
2026-10-30 (0.68 / 3.66 / 8.18 credits per 1k pages); the docs publish no AGENTIC
rate, so this test guards the demo's cost story, not a documented price.
"""
import pytest

pytestmark = pytest.mark.live


def _cost(cur, doc_id=None):
    cur.execute("CALL PARSE_COST(%s)", (doc_id,))
    cols = [c[0] for c in cur.description]
    return {r[0]: dict(zip(cols, r)) for r in cur.fetchall()}


def test_cost_reported_for_every_mode(cur):
    assert set(_cost(cur)) == {"OCR", "LAYOUT", "AGENTIC"}


def test_measured_runs_bill_the_pages_they_parsed(cur):
    # quarterly_report is 2 pages; every measured run of it bills 2 pages.
    for mode, r in _cost(cur, "quarterly_report").items():
        assert r["PAGES_BILLED"] == 2 * r["MEASURED_RUNS"], mode


def test_agentic_costs_more_per_page_than_layout_than_ocr(cur):
    c = _cost(cur)
    assert c["OCR"]["CREDITS_PER_1K_PAGES"] < c["LAYOUT"]["CREDITS_PER_1K_PAGES"] < c["AGENTIC"]["CREDITS_PER_1K_PAGES"]


def test_unmeasured_runs_are_pending_not_estimated(cur):
    cur.execute("SELECT COUNT(*) FROM PARSE_RUN_COST WHERE PENDING AND CREDITS IS NOT NULL")
    assert cur.fetchone()[0] == 0
    for r in _cost(cur).values():
        assert r["RUNS"] == r["MEASURED_RUNS"] + r["PENDING_RUNS"]
