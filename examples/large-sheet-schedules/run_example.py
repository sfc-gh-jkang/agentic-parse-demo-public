# /// script
# requires-python = ">=3.12"
# dependencies = ["pymupdf>=1.24", "snowflake-connector-python>=3.12"]
# ///
"""Run the large-sheet schedule example end to end and score every step against truth.csv.

Steps (each prints its result; the SQL for each is the constant named after it):
  1 BASELINE        single-cell AI_EXTRACT question on the full 24x36 sheet, vector and scan
  2 FULL_PARSE      LAYOUT and AGENTIC on the full sheet: what reaches `content`
  3 CLASSIFY        find the schedule pages: AI_CLASSIFY per file, and OCR per page + AI_CLASSIFY on the text
  4 LOCATE          crop the schedule: text layer for vector, OCR'd tiles for scans (locate_and_crop.py)
  5 EXTRACT         LAYOUT parse of the crop, then AI_EXTRACT over the markdown: table + the TYPE A question

Usage:
  uv run examples/large-sheet-schedules/generate_sheets.py
  uv run examples/large-sheet-schedules/run_example.py [--repeats 3] [--teardown]

Connection: SNOWFLAKE_CONNECTION (default from config.env, same as the demo). The role needs CREATE SCHEMA on
EXAMPLE_DATABASE and the SNOWFLAKE.CORTEX_USER database role. Objects go in EXAMPLE_DATABASE.EXAMPLE_SCHEMA
(default SNOWFLAKE_EXAMPLE.LARGE_SHEET_EXAMPLE); --teardown drops that schema afterwards.
Cost: every call is billed AI credits per page; one full run with --repeats 1 is about 30 calls on small pages.
"""
import argparse
import csv
import json
import os
import sys
from pathlib import Path

import snowflake.connector

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent / "scripts"))
import locate_and_crop  # noqa: E402

try:
    import demo_config  # noqa: E402
    _DEFAULT_CONN = demo_config.load().get("SNOWFLAKE_CONNECTION")
except Exception:
    _DEFAULT_CONN = None

DB = os.environ.get("EXAMPLE_DATABASE", "SNOWFLAKE_EXAMPLE")
SCHEMA = os.environ.get("EXAMPLE_SCHEMA", "LARGE_SHEET_EXAMPLE")
STAGE = f"@{DB}.{SCHEMA}.SHEETS"

# Step 0: a schema and an internal stage. SNOWFLAKE_SSE because AI functions do not read client-side encrypted stages.
SETUP = [f"CREATE SCHEMA IF NOT EXISTS {DB}.{SCHEMA}",
         f"CREATE STAGE IF NOT EXISTS {DB}.{SCHEMA}.SHEETS DIRECTORY = (ENABLE = TRUE) ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')"]

QUESTION = ("In the LIGHT FIXTURE SCHEDULE, what manufacturer name is printed in the row for fixture TYPE A? "
            "Return only the manufacturer name exactly as written in the document.")

# Step 1: the single-cell question, asked of the whole sheet.
BASELINE = """
SELECT AI_EXTRACT(file => TO_FILE(%(stage)s, %(file)s),
                  responseFormat => {'manufacturer_type_A': %(question)s},
                  scores => TRUE)"""

# Step 2: parse the whole sheet. On a 24x36 sheet LAYOUT returns the page as an image placeholder, and AGENTIC
# puts what it reads in images[].results, so `content` (what a parse -> AI_EXTRACT pipeline passes on) has no table.
FULL_PARSE = "SELECT AI_PARSE_DOCUMENT(TO_FILE(%(stage)s, %(file)s), {'mode': %(mode)s})"

# Step 3a: classify whole files. Document input to AI_CLASSIFY is Public Preview.
CLASSIFY_FILE = """
SELECT AI_CLASSIFY(TO_FILE(%(stage)s, %(file)s),
                   ['contains a light fixture schedule', 'no light fixture schedule']):labels[0]::STRING"""

# Step 3b: classify pages of a set. AI_CLASSIFY does not take FL_FILTER_PAGES, so OCR one page, classify the text.
CLASSIFY_PAGE = """
SELECT AI_CLASSIFY(
         AI_PARSE_DOCUMENT(FL_FILTER_PAGES(TO_FILE(%(stage)s, %(file)s), [{'start': %(page)s, 'end': %(page_end)s}]),
                           {'mode': 'OCR'}):pages[0]:content::STRING,
         ['contains a light fixture schedule', 'no light fixture schedule']):labels[0]::STRING"""

# Step 4 (scans): OCR each tile and look for the schedule title.
OCR_TILE = "SELECT AI_PARSE_DOCUMENT(TO_FILE(%(stage)s, %(file)s), {'mode': 'OCR'}):content::STRING"

# Step 5: the reader's own approach 2 (parse, then extract), run on the crop instead of the sheet.
TABLE_FORMAT = {"schema": {"type": "object", "properties": {"fixture_schedule": {
    "description": "LIGHT FIXTURE SCHEDULE", "type": "object", "column_ordering": ["type", "manufacturer"],
    "properties": {"type": {"description": "TYPE", "type": "array"},
                   "manufacturer": {"description": "MANUFACTURER", "type": "array"}}}}}}
EXTRACT = """
WITH parsed AS (
  SELECT AI_PARSE_DOCUMENT(TO_FILE(%(stage)s, %(file)s), {'mode': 'LAYOUT'}):content::STRING AS md
)
SELECT AI_EXTRACT(text => md, responseFormat => PARSE_JSON(%(table_format)s)) AS table_result,
       AI_EXTRACT(text => md, responseFormat => {'manufacturer_type_A': %(question)s}) AS cell_result
FROM parsed"""


def connect(conn_name):
    return snowflake.connector.connect(connection_name=conn_name, database=DB)


def one(cur, sql, **params):
    params.setdefault("stage", STAGE)
    return cur.execute(sql, params).fetchone()[0]


def put(cur, path: Path):
    cur.execute(f"PUT 'file://{path}' {STAGE} AUTO_COMPRESS = FALSE OVERWRITE = TRUE")


def truth() -> dict:
    with open(OUT / "truth.csv") as f:
        return {r["TYPE"]: r["MANUFACTURER"] for r in csv.DictReader(f)}


def score_table(result, expected: dict) -> tuple[int, int]:
    table = json.loads(result)["response"].get("fixture_schedule") or {}
    pairs = list(zip(table.get("type") or [], table.get("manufacturer") or []))
    return sum(expected.get(t) == m for t, m in pairs), len(pairs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--connection", default=os.environ.get("SNOWFLAKE_CONNECTION", _DEFAULT_CONN))
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--teardown", action="store_true")
    args = ap.parse_args()
    if not (OUT / "truth.csv").exists():
        sys.exit("Run generate_sheets.py first.")
    expected = truth()
    answer_a = expected["A"]

    with connect(args.connection) as conn:
        cur = conn.cursor()
        for sql in SETUP:
            cur.execute(sql)
        for name in ("sheet_24x36.pdf", "sheet_24x36_scan.pdf", "memo.pdf", "drawing_set.pdf", "letter_schedule.pdf"):
            put(cur, OUT / name)

        print(f"\nStep 1  BASELINE: the TYPE A question on the full sheet (truth: {answer_a})")
        for name in ("sheet_24x36.pdf", "sheet_24x36_scan.pdf", "letter_schedule.pdf"):
            for _ in range(args.repeats):
                r = json.loads(one(cur, BASELINE, file=name, question=QUESTION))
                got = r["response"]["manufacturer_type_A"]
                print(f"  {name:22} -> {got!r:28} score {r['scoring']['scores']['manufacturer_type_A']['score']}"
                      f"  {'correct' if got == answer_a else 'WRONG'}")

        print("\nStep 2  FULL_PARSE: what `content` holds after parsing the full sheet")
        for mode in ("LAYOUT", "AGENTIC"):
            r = json.loads(one(cur, FULL_PARSE, file="sheet_24x36.pdf", mode=mode))
            print(f"  {mode:8} content starts {r['content'][:45]!r}; images: {len(r.get('images', []))}")

        print("\nStep 3  CLASSIFY: which documents and pages hold a schedule")
        for name in ("sheet_24x36.pdf", "memo.pdf"):
            print(f"  file {name:20} -> {one(cur, CLASSIFY_FILE, file=name)}")
        for page in (0, 1):
            print(f"  drawing_set.pdf page {page} -> {one(cur, CLASSIFY_PAGE, file='drawing_set.pdf', page=page, page_end=page + 1)}")

        print("\nStep 4  LOCATE: crop the schedule to its own page")
        crops = {}
        sheet = OUT / "sheet_24x36.pdf"
        rect = locate_and_crop.locate_from_text(sheet)
        crops["vector"] = locate_and_crop.crop(sheet, rect, OUT / "crop_vector.pdf")
        print(f"  vector: text layer -> {rect.width / 72:.1f} x {rect.height / 72:.1f} in crop, no AI call")
        scan = OUT / "sheet_24x36_scan.pdf"
        for tile_name, tile_rect in locate_and_crop.tiles(scan):
            tile = locate_and_crop.crop(scan, tile_rect, OUT / f"tile_{tile_name}.pdf")
            put(cur, tile)
            if locate_and_crop.TITLE in (one(cur, OCR_TILE, file=tile.name) or ""):
                crops["scan"] = tile
                print(f"  scan:   OCR found the title in tile {tile_name} ({tile_rect.width / 72:.1f} x {tile_rect.height / 72:.1f} in)")
                break
        else:
            print("  scan:   title not found in any tile")
        put(cur, crops["vector"])

        print("\nStep 5  EXTRACT: LAYOUT parse of the crop, then AI_EXTRACT over the markdown")
        for kind, path in crops.items():
            for _ in range(args.repeats):
                table_result, cell_result = cur.execute(EXTRACT, {
                    "stage": STAGE, "file": path.name, "question": QUESTION,
                    "table_format": json.dumps(TABLE_FORMAT)}).fetchone()
                correct, rows = score_table(table_result, expected)
                cell = json.loads(cell_result)["response"]["manufacturer_type_A"]
                print(f"  {kind:6} table {correct}/{len(expected)} rows correct ({rows} returned); "
                      f"TYPE A -> {cell!r} {'correct' if cell == answer_a else 'WRONG'}")

        if args.teardown:
            cur.execute(f"DROP SCHEMA IF EXISTS {DB}.{SCHEMA}")
            print(f"\nDropped {DB}.{SCHEMA}")


if __name__ == "__main__":
    main()
