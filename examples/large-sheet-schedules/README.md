# Large-sheet schedules: why extraction fails on a 24x36 drawing, and the fix

A worked example for one specific failure. You ask AI_EXTRACT a simple question about a table on an electrical
drawing ("what manufacturer is in the row for fixture TYPE A?"), and it returns a confident-looking name that
is not on the sheet. Parsing first with LAYOUT or AGENTIC and extracting from the text does not help.

The cause is page size. A schedule set in 5.5 pt type, in the corner of a 36 x 24 inch sheet, is too small
relative to the page to be read. The fix is to find the schedule, crop it to its own page, and then run the
same parse-then-extract pipeline on the crop. Every name in this example is fictional (see
[About the data](#about-the-data)).

## Results

Measured 2026-11-12 on an AWS US East 1 account with cross-region inference enabled
(`CORTEX_ENABLED_CROSS_REGION = ANY_REGION`), three runs of each step. `run_example.py --repeats 3` reproduces every line.

| Step | Input | Result |
|---|---|---|
| 1. Single-cell question, whole sheet | 24x36 vector PDF | Wrong, 3 of 3 runs. Returned a manufacturer that is not on the sheet, score 0.2 |
| | 24x36 scanned PDF | Wrong, 3 of 3 runs, score 0.2 |
| | Same schedule on a letter-size page | Correct, 3 of 3 runs, score 0.88 |
| 2. Parse the whole sheet | LAYOUT | `content` is image placeholders, no table text |
| | AGENTIC | Same `content`; what it reads sits in `images[].results` |
| 3. Find schedule documents and pages | AI_CLASSIFY on the file | Sheet and unrelated memo both labelled correctly |
| | OCR one page, then AI_CLASSIFY on the text | Both pages of a two-page set labelled correctly |
| 4. Crop the schedule | Vector: PDF text layer | 5.0 x 5.7 in crop, no AI call |
| | Scan: 6 overlapping tiles, OCR each | Title found in one tile (13.8 x 13.8 in) |
| 5. LAYOUT parse of the crop, then AI_EXTRACT | Vector crop | 40 of 40 rows, TYPE A correct, 3 of 3 runs |
| | Scan crop | 40 of 40 rows, TYPE A correct, 3 of 3 runs |

Two things worth knowing from step 1. First, the score was the only signal that something was wrong: 0.2 on
every wrong answer, 0.88 on the readable page. Treat a low score as a reason to route the document elsewhere.
Do not treat a high score as proof, because the score is not documented as a measure of correctness.
Second, LAYOUT and AGENTIC give the same `content` on the full sheet, which is why a parse-then-extract
pipeline returns the same wrong answer in both modes.

## The steps, in code

Each step is a SQL constant in [`run_example.py`](run_example.py), named after the step.

**1. Baseline (`BASELINE`).** The single-cell question against the whole file:

```sql
SELECT AI_EXTRACT(file => TO_FILE('@SHEETS', 'sheet_24x36.pdf'),
                  responseFormat => {'manufacturer_type_A': 'In the LIGHT FIXTURE SCHEDULE, ...'},
                  scores => TRUE);
```

**2. Full-sheet parse (`FULL_PARSE`).** `AI_PARSE_DOCUMENT` in LAYOUT and AGENTIC. Look at `content`, which is
what a parse-then-extract pipeline passes on.
https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document

**3. Classify (`CLASSIFY_FILE`, `CLASSIFY_PAGE`).** AI_CLASSIFY accepts a file directly, but it does not
accept `FL_FILTER_PAGES`; it fails to compile. To label pages inside a set, parse one page in OCR mode
(the cheapest mode) and classify the text. Document input to AI_CLASSIFY is Public Preview.
https://docs.snowflake.com/en/sql-reference/functions/ai_classify

```sql
SELECT AI_CLASSIFY(
         AI_PARSE_DOCUMENT(FL_FILTER_PAGES(TO_FILE('@SHEETS', 'drawing_set.pdf'), [{'start': 1, 'end': 2}]),
                           {'mode': 'OCR'}):pages[0]:content::STRING,
         ['contains a light fixture schedule', 'no light fixture schedule']):labels[0]::STRING;
```

With a page filter the parse output is under `pages[i].content`, not `content`.

**4. Locate and crop ([`locate_and_crop.py`](locate_and_crop.py)).** The AI functions select pages
(`FL_FILTER_PAGES`) but not regions, so the crop happens in Python before the file is staged.

- **Vector PDFs** have a text layer. `locate_from_text` finds the schedule title and grows a box down the table
  until the first large vertical gap, which separates it from the notes below. This step costs nothing.
- **Scanned PDFs** have no text layer. `tiles` cuts the sheet into a 3 x 2 grid with 15% overlap, so a schedule
  on an edge is whole in one tile. The runner OCRs each tile (`OCR_TILE`) and keeps the first one that contains
  the title.

Crops use `show_pdf_page`, so vector content stays vector.

**5. Extract (`EXTRACT`).** The same parse-then-extract pipeline, run on the crop: LAYOUT, then AI_EXTRACT
over the markdown with a table schema. `column_ordering` matches the order of the columns on the sheet.
https://docs.snowflake.com/en/user-guide/snowflake-cortex/document-extraction

```sql
WITH parsed AS (
  SELECT AI_PARSE_DOCUMENT(TO_FILE('@SHEETS', 'crop_vector.pdf'), {'mode': 'LAYOUT'}):content::STRING AS md
)
SELECT AI_EXTRACT(text => md, responseFormat => {
  'schema': {'type': 'object', 'properties': {'fixture_schedule': {
    'description': 'LIGHT FIXTURE SCHEDULE', 'type': 'object', 'column_ordering': ['type', 'manufacturer'],
    'properties': {'type': {'description': 'TYPE', 'type': 'array'},
                   'manufacturer': {'description': 'MANUFACTURER', 'type': 'array'}}}}}})
FROM parsed;
```

Scalar and array facts go in the same `responseFormat`, alongside the table.

## Run it

```bash
uv run examples/large-sheet-schedules/generate_sheets.py          # writes out/ (gitignored)
SNOWFLAKE_CONNECTION=<name> uv run examples/large-sheet-schedules/run_example.py --repeats 1 --teardown
```

- Objects go in `SNOWFLAKE_EXAMPLE.LARGE_SHEET_EXAMPLE`. Override this with `EXAMPLE_DATABASE` and
  `EXAMPLE_SCHEMA`.
- `--teardown` drops the schema at the end.
- The role needs CREATE SCHEMA on the database and the `SNOWFLAKE.CORTEX_USER` database role.
- Every AI function call is billed in AI credits. One run with `--repeats 1` makes about 30 calls, almost all on
  small pages. Check current rates at https://docs.snowflake.com/en/user-guide/snowflake-cortex/pricing
  before running at scale.

Offline tests (no Snowflake): `uv run --with pymupdf pytest tests/test_large_sheet_example.py`.

## Other routes we measured

These are not in the runner. They were measured during the investigation, three runs each unless noted.

- **AI_COMPLETE on the whole file** (claude-sonnet-4-6, response_format schema). Measured on an earlier version
  of this sheet: the same layout, with different placeholder names. The vector sheet got 40 of 40, using about
  3,400 input and 670 output tokens. The scanned sheet got 0 to 2 of 40. The AI_COMPLETE prompt-object
  docs also say a JSON schema is not supported when the prompt includes a file, so this is field-observed only.
  https://docs.snowflake.com/en/sql-reference/functions/ai_complete-prompt-object
- **AGENTIC region boxes as the crop source:** on the vector sheet AGENTIC returned the schedule as its own
  region, 3 of 3 runs. On the scan it returned the whole sheet as one region, 3 of 3 runs, so it cannot be relied
  on to locate the table. The coordinates looked like pixels at about 200 DPI, but the docs do not state the unit.
- **Picking a tile by the extraction score:** this did not work, in one run over the six tiles. Empty tiles
  scored 0.78, above the tile that held the schedule. Finding the title with OCR (step 4) is the reliable signal.

## About the data

`generate_sheets.py` draws the whole set, so the ground truth is exact (`out/truth.csv`). Everything is
invented: the project, the engineer and all ten manufacturers. `tests/test_large_sheet_example.py` fails if any
of a list of real lighting brands appears on a generated page.

What the sheet copies from real electrical drawings:

- the 36 x 24 inch page
- small schedule type
- floor-plan linework and tags
- a merged "BASIS OF DESIGN" header over the MANUFACTURER column
- general notes that also talk about manufacturers

What it does not copy: rotated text, multi-line cells, or schedules split across sheets.

Real drawing sets are the test that matters. This example shows where to look.
