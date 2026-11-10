# Stage 2 report: Parse Mode accuracy and measured cost

Generated 2026-11-12 11:07 from stored Parse Runs in region PUBLIC.AWS_US_EAST_1 by `scripts/report.py`. Accuracy is scored by `COMPARE_MODES` against the Corpus Ground Truth (method in `scoring/score.py`); cost is measured by `PARSE_COST` from `SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY` (https://docs.snowflake.com/en/sql-reference/account-usage/cortex_ai_functions_usage_history). AGENTIC mode is in preview (https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode).

## Corpus totals

| Measure | OCR | LAYOUT | AGENTIC |
|---|---|---|---|
| Facts inside images | 222/244 (91%) | 166/244 (68%) | 238/244 (98%) |
| Facts in page text | 250/250 (100%) | 250/250 (100%) | 250/250 (100%) |
| Relations (value with its label, edge, row) | 59/125 (47%) | 85/125 (68%) | 123/125 (98%) |
| Visuals detected and typed | n/a (text only) | n/a (text only) | 15/28 (54%) |
| Measured AI credits per 1,000 pages | 0.6800 | 3.6600 | 8.1800 |
| Runs measured / pending | 24 / 0 | 18 / 0 | 19 / 0 |

Credits are AI credits billed per page, excluding warehouse credits. They include every stored run, test runs too.

## Per Document

Each cell: facts inside images · relations · visuals detected (AGENTIC only).

| Document | OCR | LAYOUT | AGENTIC |
|---|---|---|---|
| `claim_packet` | 92/102 · 1/27 · – | 82/102 · 20/27 · – | 98/102 · 27/27 · 6/13 |
| `control_contract` | 0/0 · 0/0 · – | 0/0 · 0/0 · – | 0/0 · 0/0 · 0/0 |
| `floor_plan_diagram` | 17/17 · 0/7 · – | 4/17 · 0/7 · – | 17/17 · 7/7 · 1/1 |
| `inspection_form` | 10/14 · 0/0 · – | 14/14 · 0/0 · – | 14/14 · 0/0 · 1/3 |
| `multipage_rate_table` | 19/19 · 48/53 · – | 19/19 · 53/53 · – | 19/19 · 53/53 · 0/1 |
| `pitch_deck` | 27/27 · 6/14 · – | 15/27 · 4/14 · – | 26/27 · 12/14 · 2/3 |
| `quarterly_report` | 25/31 · 1/13 · – | 4/31 · 0/13 · – | 30/31 · 13/13 · 3/3 |
| `receipt_photo` | 15/15 · 0/5 · – | 15/15 · 5/5 · – | 15/15 · 5/5 · 0/0 |
| `scanned_contract` | 6/6 · 0/0 · – | 6/6 · 0/0 · – | 6/6 · 0/0 · 0/0 |
| `stamped_invoice` | 3/3 · 2/3 · – | 1/3 · 3/3 · – | 3/3 · 3/3 · 1/3 |
| `whiteboard_photo` | 8/10 · 1/3 · – | 6/10 · 0/3 · – | 10/10 · 3/3 · 1/1 |

## What AGENTIC missed

- `claim_packet`: 2026-09-16; RECEIVED; PL-2026-44718; % moisture content; visual: logo; visual: stamp; visual: signature; visual: sticky_note; visual: Moisture Readings - Server Room floor grid, 2026-09-13; visual: infographic; visual: signature
- `inspection_form`: visual: SECTION B - VISUAL CHECKS; visual: handwriting
- `multipage_rate_table`: visual: table
- `pitch_deck`: Customers | 2140; Gross margin | 78; Revenue by Segment (USD millions); visual: infographic
- `quarterly_report`: Revenue Mix by Region
- `stamped_invoice`: visual: logo; visual: signature

## Method

- A *fact* is one visible value from Ground Truth. It counts when it appears on its own page, in the page text or in the values (not key names) of that page's Visual results. Only a table that spans pages may match on another page.
- Numbers match to the precision Ground Truth states: 13.8 accepts 13.75 to 13.85, a whole number needs that exact number, and dates are not read as numbers.
- A *relation* counts only when its values are paired: a markdown table row, values next to each other on one line, or a small object in the structured results. Prose summaries never pair values.
- A Visual counts as detected when an AGENTIC Visual of an accepted type overlaps the drawn box (IoU at least 0.3) on the same page. Whole-page scans and photos are read as the page, so they are scored as facts, not as Visuals.
- These rules were tightened after an independent review found that looser matching let OCR text lines count as paired values. `tests/test_compare_fairness.py` holds the exploit cases; 7 of its 10 fail against the earlier scorer.

## Ground Truth edits made while building the scorer

- `inspection_form`, `claim_packet`: image_type `form` changed to `other` (with accepted alternatives), because `form` is not a type AGENTIC can return (https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode). No drawn content changed; the PDFs are byte-identical.
- `control_contract`: added text-channel facts (title, effective date, parties, governing law, clause headings) so the Control Document has something to score. They were taken from the generator's own text; the PDF is byte-identical.
- No other Ground Truth value was changed.
