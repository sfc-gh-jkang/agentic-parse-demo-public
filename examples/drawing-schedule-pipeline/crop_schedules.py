"""Crop schedule regions out of large-format electrical drawings.

Runs inside a Snowpark procedure (see pipeline.sql) and locally for testing.
Detection uses the PDF's own geometry, not fixed coordinates:
  - a schedule = the smallest ruled table that contains a heading ending in SCHEDULE,
    cut at any '... NOTES' heading inside it;
  - if no ruled table surrounds the heading, grow a box down from it until the first large vertical gap
    (the same method as ../large-sheet-schedules/locate_and_crop.py, written with pdfplumber because
    PyMuPDF is not in the Snowflake Anaconda channel);
  - the title block = the right-edge strip where sheet number, job and date live.
"""
import io
import re

import pdfplumber
import pypdfium2 as pdfium

DPI = 200
HEADING = re.compile(r"^[A-Z0-9 '&/\-]*SCHEDULE$")
NOTES = re.compile(r"NOTES")
TITLE_STRIP_FRACTION = 0.115   # right-edge title block on ARCH D/E sheets
MARGIN = 6                     # points of padding around each crop
MAX_WIDTH_PT = 12 * 72         # widest schedule the gap fallback will take
GAP_PT = 20                    # a vertical gap this large ends the table


def slug(text):
    return re.sub(r"[^A-Z0-9]+", "_", text.upper()).strip("_").lower()


def grow_from_heading(words, head):
    """Box from the heading down through the words beneath it, until the first gap larger than GAP_PT."""
    x_min, x_max = head["x0"] - 20, head["x0"] + MAX_WIDTH_PT
    below = sorted((w for w in words if w["top"] >= head["top"] and x_min <= w["x0"] <= x_max),
                   key=lambda w: w["top"])
    x0, top, x1, bottom = head["x0"], head["top"], head["x1"], head["bottom"]
    for w in below:
        if w["top"] - bottom > GAP_PT:
            break
        x0, x1 = min(x0, w["x0"]), max(x1, w["x1"])
        bottom = max(bottom, w["bottom"])
    return x0, top, x1, bottom


def find_regions(page):
    """Return [(region_name, (x0, top, x1, bottom))] in page display coordinates."""
    words = page.extract_words(keep_blank_chars=True, x_tolerance=2)
    tables = [t.bbox for t in page.find_tables()]
    regions = []
    for w in words:
        text = w["text"].strip().strip("'")
        if not HEADING.match(text):
            continue
        inside = [b for b in tables
                  if b[0] <= w["x0"] and b[1] <= w["top"] and b[2] >= w["x1"] and b[3] >= w["bottom"]
                  and (b[2] - b[0]) < page.width * 0.9]          # skip the sheet border
        if inside:
            x0, top, x1, bottom = min(inside, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        else:
            x0, top, x1, bottom = grow_from_heading(words, w)
        notes = [n["top"] for n in words
                 if NOTES.search(n["text"]) and x0 <= n["x0"] <= x1 and w["bottom"] < n["top"] < bottom]
        if notes:
            bottom = min(notes)
        regions.append((slug(text), (x0, top, x1, bottom)))
    regions.append(("title_block", (page.width * (1 - TITLE_STRIP_FRACTION), 0, page.width, page.height)))
    return regions


def crop_pdf(pdf_bytes):
    """Yield (page_no, region_name, png_bytes, region_text) for every detected region on every page.

    region_text is the PDF's own text layer inside the crop ('' for scanned drawings). The pipeline
    uses it to check AI-extracted catalog numbers character for character.
    """
    scale = DPI / 72.0
    doc = pdfium.PdfDocument(pdf_bytes)
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as plumb:
        for i, page in enumerate(plumb.pages):
            image = doc[i].render(scale=scale).to_pil()       # rendered with the page rotation applied
            for name, (x0, top, x1, bottom) in find_regions(page):
                box = (max(0, int((x0 - MARGIN) * scale)), max(0, int((top - MARGIN) * scale)),
                       min(image.width, int((x1 + MARGIN) * scale)), min(image.height, int((bottom + MARGIN) * scale)))
                buf = io.BytesIO()
                image.crop(box).save(buf, format="PNG")
                text = page.within_bbox((x0, top, x1, bottom)).extract_text() or ""
                yield i + 1, name, buf.getvalue(), text
    doc.close()


if __name__ == "__main__":
    import pathlib
    import sys
    src = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for page_no, name, png, text in crop_pdf(src.read_bytes()):
        path = out / f"{src.stem}__p{page_no:03d}__{name}.png"
        path.write_bytes(png)
        print(path.name, len(png), f"{len(text)} chars of text layer")
