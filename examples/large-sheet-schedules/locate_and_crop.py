# /// script
# requires-python = ">=3.12"
# dependencies = ["pymupdf>=1.24"]
# ///
"""Find the schedule on a large drawing sheet and crop it to its own page.

Why this step exists: on a full 24x36 sheet the schedule text is about 5.5 pt on a 36-inch page, and
AI_EXTRACT answers a question about it without being able to read it (see README, step 1). Cropped to its
own page, the same text reads correctly with LAYOUT and AI_EXTRACT. The AI functions select pages
(FL_FILTER_PAGES) but not regions, so the crop happens here, before the file is staged.

Two ways to find the schedule:
  vector PDFs  the PDF has a text layer, so search it for the title and grow the box down the table.
               No AI call, no cost.
  scanned PDFs no text layer. Cut the sheet into overlapping tiles; the caller OCRs each tile
               (AI_PARSE_DOCUMENT mode OCR, the cheapest mode) and keeps the tile that holds the title.

Crops keep vector content as vectors (show_pdf_page), so nothing is rasterised.
"""
from pathlib import Path

import pymupdf

TITLE = "LIGHT FIXTURE SCHEDULE"


def has_text_layer(pdf: Path) -> bool:
    with pymupdf.open(pdf) as doc:
        return bool(doc[0].get_text("text").strip())


def locate_from_text(pdf: Path, title: str = TITLE, max_width_in: float = 12, gap_pt: float = 20,
                     pad_pt: float = 10) -> pymupdf.Rect | None:
    """Box around the schedule title and the table beneath it, from the PDF's own text layer.

    Starts at the title and takes words below it, inside a column up to max_width_in wide, until the first
    vertical gap larger than gap_pt. A gap that size separates the table from whatever follows it (notes,
    a title block). Returns None when the title is not on the page.
    """
    with pymupdf.open(pdf) as doc:
        page = doc[0]
        hits = page.search_for(title)
        if not hits:
            return None
        head = hits[0]
        x_min, x_max = head.x0 - 20, head.x0 + max_width_in * 72
        words = sorted((w for w in page.get_text("words")
                        if w[1] >= head.y0 and x_min <= w[0] <= x_max), key=lambda w: w[1])
        box = pymupdf.Rect(head)
        last_bottom = head.y1
        for x0, y0, x1, y1, *_ in words:
            if y0 - last_bottom > gap_pt:
                break
            box |= pymupdf.Rect(x0, y0, x1, y1)
            last_bottom = max(last_bottom, y1)
        return (box + (-pad_pt, -pad_pt, pad_pt, pad_pt)) & page.rect


def tiles(pdf: Path, cols: int = 3, rows: int = 2, overlap: float = 0.15) -> list[tuple[str, pymupdf.Rect]]:
    """Overlapping grid over the page, as (name, rect). 15% overlap so a schedule on a tile edge is whole in one tile."""
    with pymupdf.open(pdf) as doc:
        w, h = doc[0].rect.width, doc[0].rect.height
    tw, th = w / cols, h / rows
    out = []
    for r in range(rows):
        for c in range(cols):
            rect = pymupdf.Rect(max(0, (c - overlap) * tw), max(0, (r - overlap) * th),
                                min(w, (c + 1 + overlap) * tw), min(h, (r + 1 + overlap) * th))
            out.append((f"r{r}c{c}", rect))
    return out


def crop(pdf: Path, rect: pymupdf.Rect, dst: Path) -> Path:
    """Write rect of page 0 as a new single-page PDF the size of rect."""
    with pymupdf.open(pdf) as src:
        out = pymupdf.open()
        page = out.new_page(width=rect.width, height=rect.height)
        page.show_pdf_page(page.rect, src, 0, clip=rect)
        out.save(dst)
    return dst


if __name__ == "__main__":
    import sys
    target = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "out" / "sheet_24x36.pdf")
    if has_text_layer(target):
        r = locate_from_text(target)
        print(f"{target.name}: text layer, schedule at {r} ({r.width / 72:.1f} x {r.height / 72:.1f} in)")
    else:
        print(f"{target.name}: no text layer, {len(tiles(target))} tiles to OCR")
