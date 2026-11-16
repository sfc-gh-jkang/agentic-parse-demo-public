"""Offline checks for examples/drawing-schedule-pipeline: the crop step finds the schedule on the synthetic sheet.

The pipeline itself (stream, task, AI_EXTRACT dynamic tables) runs in Snowflake and is billed, so it is not run here.
Uses the synthetic 24x36 sheet from examples/large-sheet-schedules, so every name is fictional.
"""
import importlib.util
import sys
from pathlib import Path

import pytest

pytest.importorskip("pymupdf")
pytest.importorskip("reportlab")
pdfplumber = pytest.importorskip("pdfplumber")
pytest.importorskip("pypdfium2")

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"


def _load(folder, name):
    spec = importlib.util.spec_from_file_location(name, EXAMPLES / folder / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def sheet(tmp_path_factory):
    gen = _load("large-sheet-schedules", "generate_sheets")
    gen.OUT = tmp_path_factory.mktemp("sheets")
    gen.main()
    return gen, gen.OUT / "sheet_24x36.pdf"


def test_finds_fixture_schedule_and_title_block(sheet):
    crop = _load("drawing-schedule-pipeline", "crop_schedules")
    with pdfplumber.open(sheet[1]) as pdf:
        names = [name for name, _ in crop.find_regions(pdf.pages[0])]
    assert "light_fixture_schedule" in names
    assert "title_block" in names


def test_crop_text_holds_every_row_and_no_notes(sheet):
    gen, path = sheet
    crop = _load("drawing-schedule-pipeline", "crop_schedules")
    regions = {name: (png, text) for _, name, png, text in crop.crop_pdf(path.read_bytes())}
    png, text = regions["light_fixture_schedule"]
    for fixture_type, _, manufacturer, _ in gen.schedule_rows():
        assert fixture_type in text and manufacturer in text
    assert "GENERAL NOTES" not in text
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
