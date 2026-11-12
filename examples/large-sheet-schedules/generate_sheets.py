# /// script
# requires-python = ">=3.12"
# dependencies = ["reportlab>=4.2", "pymupdf>=1.24"]
# ///
"""Generate the synthetic drawing set for the large-sheet schedule example.

Every name is fictional: the project, the engineer and all ten manufacturers. Nothing comes from a real
drawing set. The layout copies what makes real electrical sheets hard: a 24x36 page, 5.5 pt schedule text
in one corner, floor-plan linework and tags across the rest, a merged header ("BASIS OF DESIGN") over the
MANUFACTURER column, and general notes that also mention manufacturers.

Outputs, in out/ (gitignored):
  sheet_24x36.pdf        vector drawing sheet, 36 x 24 in
  sheet_24x36_scan.pdf   the same sheet rasterised at 150 DPI as JPEG, as a scanned set would arrive
  letter_schedule.pdf    the schedule alone on a letter-size page (the control)
  memo.pdf               an unrelated one-page memo (classification negative)
  drawing_set.pdf        memo + sheet as one two-page set (page-level classification)
  truth.csv              TYPE,MANUFACTURER for all 40 schedule rows

Usage: uv run examples/large-sheet-schedules/generate_sheets.py
"""
import csv
import random
from pathlib import Path

import pymupdf
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent / "out"
SEED = 7
SHEET_W, SHEET_H = 36 * 72, 24 * 72
SCHEDULE_X, SCHEDULE_TOP = 1800, SHEET_H - 80  # top-right corner, where schedules usually sit

MANUFACTURERS = ["NORTHWIND LUMINAIRE", "HARBORLINE LIGHTING", "KESTREL OPTICS", "ASHGROVE FIXTURE CO",
                 "TALLSPIRE LED", "OXBOW ILLUMINATION", "MERIDIAN ARC", "CINDERFIELD LIGHTING",
                 "PALEWATER LIGHTING", "BRAMBLE AND STONE"]
DESCRIPTIONS = ["LED DOWNLIGHT", "LINEAR PENDANT", "WALL SCONCE", "STRIP", "HIGH BAY", "STEP LIGHT"]
NOTES = ["GENERAL NOTES",
         "1. SUBSTITUTIONS: PRODUCTS OF OTHER MANUFACTURERS SHALL BE SUBMITTED WITH FULL PHOTOMETRIC DATA.",
         "2. ALL FIXTURES SHALL BE UL LISTED. COORDINATE FINISHES WITH ARCHITECT BEFORE ORDER."]


def schedule_rows(seed: int = SEED) -> list[tuple[str, str, str, str]]:
    """40 rows of (TYPE, DESCRIPTION, MANUFACTURER, CATALOG NO.). Row A is fixed so the TYPE A question has one answer."""
    rng = random.Random(seed)
    rows = [("A", "2X4 LED TROFFER", MANUFACTURERS[0], "NWL-2440-ML")]
    for i in range(39):
        fixture_type = chr(66 + i % 24) + (str(i // 24 + 1) if i >= 24 else "")
        rows.append((fixture_type, rng.choice(DESCRIPTIONS), rng.choice(MANUFACTURERS[1:]),
                     "CAT-%04d" % rng.randint(1, 9999)))
    return rows


def draw_schedule(c: canvas.Canvas, rows, x0: float, y0: float) -> float:
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x0, y0, "LIGHT FIXTURE SCHEDULE")
    xs = [x0, x0 + 40, x0 + 170, x0 + 300]
    y = y0 - 16
    c.setFont("Helvetica-Bold", 5.5)
    c.drawString(xs[2], y + 8, "BASIS OF DESIGN")
    for x, h in zip(xs, ["TYPE", "DESCRIPTION", "MANUFACTURER", "CATALOG NO."]):
        c.drawString(x, y, h)
    c.setFont("Helvetica", 5.5)
    c.setLineWidth(0.3)
    for row in rows:
        y -= 9
        for x, v in zip(xs, row):
            c.drawString(x, y, v)
        c.line(x0 - 4, y - 2, x0 + 420, y - 2)
    return y


def draw_sheet(path: Path, rows) -> None:
    rng = random.Random(SEED + 1)
    c = canvas.Canvas(str(path), pagesize=(SHEET_W, SHEET_H))
    c.setLineWidth(0.3)
    for _ in range(300):  # floor-plan linework
        x, y = rng.uniform(50, 1700), rng.uniform(80, SHEET_H - 80)
        c.line(x, y, x + rng.uniform(-200, 200), y + rng.uniform(-200, 200))
    c.setFont("Helvetica", 5)
    for _ in range(120):  # fixture tags and labels on the plan
        c.drawString(rng.uniform(50, 1700), rng.uniform(80, SHEET_H - 80),
                     rng.choice(["A", "B", "C2", "EM", "J-BOX", "LP-1-12", "TYP."]))
    y = draw_schedule(c, rows, SCHEDULE_X, SCHEDULE_TOP) - 30
    c.setFont("Helvetica", 5.5)
    for line in NOTES:
        c.drawString(SCHEDULE_X, y, line)
        y -= 8
    c.rect(SHEET_W - 300, 30, 270, 110)
    c.drawString(SHEET_W - 290, 120, "SHEET E-602  ELECTRICAL SCHEDULES  -  HOLLOWAY CREEK CLINIC")
    c.drawString(SHEET_W - 290, 108, "ENGINEER: FENWICK MEP ASSOCIATES (FICTIONAL)")
    c.save()


def draw_memo(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setFont("Helvetica", 10)
    for i, t in enumerate(["SITE VISIT MEMO", "Date: Oct 2 2026",
                           "Discussed parking lot striping and a two-week landscaping slip.",
                           "No electrical issues observed."]):
        c.drawString(60, 740 - i * 16, t)
    c.save()


def rasterise(src: Path, dst: Path, dpi: int = 150) -> None:
    """Simulate a scanned sheet: render the page to JPEG and wrap it back into a PDF with no text layer."""
    doc = pymupdf.open(src)
    page = doc[0]
    jpeg = page.get_pixmap(dpi=dpi).tobytes("jpg", jpg_quality=80)
    out = pymupdf.open()
    out.new_page(width=page.rect.width, height=page.rect.height).insert_image(page.rect, stream=jpeg)
    out.save(dst, deflate=True)


def letter_control(sheet: Path, dst: Path) -> None:
    """The schedule region of the sheet, scaled onto a letter-size landscape page."""
    src = pymupdf.open(sheet)
    clip = pymupdf.Rect(SCHEDULE_X - 20, 0, SHEET_W, SHEET_H * 0.45)
    out = pymupdf.open()
    page = out.new_page(width=792, height=612)
    page.show_pdf_page(page.rect, src, 0, clip=clip)
    out.save(dst)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    rows = schedule_rows()
    draw_sheet(OUT / "sheet_24x36.pdf", rows)
    rasterise(OUT / "sheet_24x36.pdf", OUT / "sheet_24x36_scan.pdf")
    letter_control(OUT / "sheet_24x36.pdf", OUT / "letter_schedule.pdf")
    draw_memo(OUT / "memo.pdf")
    drawing_set = pymupdf.open()
    for part in ("memo.pdf", "sheet_24x36.pdf"):
        drawing_set.insert_pdf(pymupdf.open(OUT / part))
    drawing_set.save(OUT / "drawing_set.pdf")
    with open(OUT / "truth.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["TYPE", "MANUFACTURER"])
        w.writerows((r[0], r[2]) for r in rows)
    for p in sorted(OUT.iterdir()):
        print(f"{p.name:24} {p.stat().st_size:>9,} bytes")


if __name__ == "__main__":
    main()
