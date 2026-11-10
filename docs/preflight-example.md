# Pre-flight report

Generated 2026-11-01 07:07 EST by `scripts/preflight.py` on the author's demo account. Each answer comes from AI_COMPLETE (`claude-sonnet-5-5`) over ONE mode's stored parse text, with the same prompt as the app's Compare answers table. Credits are measured from `CORTEX_AI_FUNCTIONS_USAGE_HISTORY` via `PARSE_RUN_COST`; "pending" means telemetry had not reported yet (it can lag minutes), never an estimate.

## receipt_photo.jpg

| Mode | Pages | Parse seconds | Visuals reported | AI credits (measured) |
|---|---|---|---|---|
| AGENTIC | 1 | 21.9 | 0 | 0.008180 |
| LAYOUT | 1 | 115.9 | n/a | 0.003660 |
| OCR | 1 | 5.6 | n/a | 0.000680 |

| Question | AGENTIC | LAYOUT | OCR | Verdict |
|---|---|---|---|---|
| Does this document contain a table? If so, give its title or first column header and one row's values. | No table with a title or column headers appears in the parse; it is a receipt with line items and prices (e.g., "Dish soap 3.49") in plain text. | Not in this parse | Not in this parse | none answer* |
| Is there a number that appears only inside a chart, image, photo or stamp? Give one such number and what it measures. | Not in this parse | Not in this parse | Not in this parse | none answer |
| Is there a checkbox or tick box? Give one label and whether it is checked. | Not in this parse | Not in this parse | Not in this parse | none answer |
| What is the single most important total, amount or date in the document, with its label? | TOTAL: 29.45 (receipt total, including 8% tax of 2.18 on a subtotal of 27.27) | TOTAL: 29.45 (receipt total, including 8% tax of 2.18 on a subtotal of 27.27) | TOTAL: 29.45 (on the Harbor Street Market receipt dated 2026-09-21) | tie (all answer) |

Summary: AGENTIC wins 0, ties 1, of 4 questions. AGENTIC adds little on this document; LAYOUT is enough and cheaper. Consider a document with charts, stamps or photos.

\* The script first scored this row "AGENTIC wins" because the model set found=true on a "No table ..." answer. `parse_answer` now treats answers starting with No / There is no / None as not found (test `test_negative_answer_counts_as_not_found`); this row and the summary were re-classified from the recorded answers above rather than paying for a third run. Expected outcome: a plain receipt photo is a weak AGENTIC demo document (0 Visuals reported), which is what pre-flight is for.

This run was the second on 2026-11-01; the first was discarded because AI_COMPLETE's JSON-quoted reply was not unwrapped (every answer looked found). Billed in total: 2 x (1 AGENTIC + 1 LAYOUT + 1 OCR) pages.

Upload `up_pf_receipt_photo_594b4b` deleted after the run.
