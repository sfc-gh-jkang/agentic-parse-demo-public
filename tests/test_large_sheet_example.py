"""Offline checks for examples/large-sheet-schedules: the generated data is fictional and the locator finds the table.

The live steps (AI_EXTRACT, AI_PARSE_DOCUMENT, AI_CLASSIFY) are in run_example.py and billed, so they are not run here.
"""
import importlib.util
import sys
from pathlib import Path

import pytest

pymupdf = pytest.importorskip("pymupdf")
pytest.importorskip("reportlab")

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "large-sheet-schedules"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, EXAMPLE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def generated(tmp_path_factory):
    gen = _load("generate_sheets")
    gen.OUT = tmp_path_factory.mktemp("sheets")
    gen.main()
    return gen


def test_forty_rows_and_type_a_is_fixed(generated):
    rows = generated.schedule_rows()
    assert len(rows) == 40
    assert rows[0][:3] == ("A", "2X4 LED TROFFER", "NORTHWIND LUMINAIRE")
    assert len({r[0] for r in rows}) == 40


def test_sheet_is_24_by_36(generated):
    with pymupdf.open(generated.OUT / "sheet_24x36.pdf") as doc:
        assert (doc[0].rect.width, doc[0].rect.height) == (36 * 72, 24 * 72)


def test_scan_has_no_text_layer(generated):
    loc = _load("locate_and_crop")
    assert loc.has_text_layer(generated.OUT / "sheet_24x36.pdf")
    assert not loc.has_text_layer(generated.OUT / "sheet_24x36_scan.pdf")


def test_no_real_brand_or_customer_text(generated):
    """Every manufacturer is invented; none of these real names may appear on any generated page."""
    banned = ["LITHONIA", "ACUITY", "GOTHAM", "METALUX", "LUMARK", "HALO", "PRESCOLITE",
              "FOCAL POINT", "LUMENWERX", "BEGA", "DAYBRITE", "COOPER", "SIGNIFY"]
    for name in ("sheet_24x36.pdf", "letter_schedule.pdf", "memo.pdf", "drawing_set.pdf"):
        with pymupdf.open(generated.OUT / name) as doc:
            text = " ".join(p.get_text() for p in doc).upper()
        assert not [b for b in banned if b in text], name


def test_text_locator_box_holds_every_row_and_no_notes(generated):
    loc = _load("locate_and_crop")
    sheet = generated.OUT / "sheet_24x36.pdf"
    rect = loc.locate_from_text(sheet)
    with pymupdf.open(sheet) as doc:
        inside = doc[0].get_text("text", clip=rect)
    for fixture_type, _, manufacturer, _ in generated.schedule_rows():
        assert fixture_type in inside and manufacturer in inside
    assert "GENERAL NOTES" not in inside
    assert rect.width < 8 * 72 and rect.height < 8 * 72  # small enough to read: the whole point of the crop


def test_one_tile_contains_the_whole_schedule(generated):
    loc = _load("locate_and_crop")
    table = loc.locate_from_text(generated.OUT / "sheet_24x36.pdf")
    assert any(rect.contains(table) for _, rect in loc.tiles(generated.OUT / "sheet_24x36_scan.pdf"))
