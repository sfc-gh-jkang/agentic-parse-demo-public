# Storyline beats (from docs/talk-track.md)

Chips in the empty chat are these questions verbatim; `tests/test_storyline_consistency.py` guards the wording.
Open `docs/talk-track.md` for the exact click path, numbers and fallbacks; do not quote figures from memory.

| Beat | Point | Billed? |
|---|---|---|
| Opening payoff | Same question, three parses of quarterly_report: only AGENTIC finds the chart value; Compare table shows AGENTIC vs LAYOUT/OCR. State: AGENTIC accepts no prompt or schema | no (cached) |
| Value | **What AGENTIC is worth** panel and the `value_story` tool: measured credits per 1,000 pages, facts and relations found, pages left to check by hand, credits per correct fact. Honest line: OCR is cheapest per fact; AGENTIC wins on review. Cost includes review time: audience types minutes/page, $/hour, pages/month and optional price per credit; results are estimates from measured rates | no (stored data) |
| Beat 1 | Score strip against Ground Truth; "agentic" means two things (parse mode vs Cortex Agent) | no |
| Beat 2 | Multi-step goal; agent chains tools and moves the screen; **How I answered** lists the steps | chat only |
| Beat 3 | Limits: refuses unknowns, **What was missed**, LAYOUT is enough on plain text | no |
| Beat 4 | Re-parse: agent states Document, pages, Mode, cost and waits for a bare yes | yes, after confirm |
| Beat 5 | Evals: tool-order grading from `docs/model-eval.md` | no |
| Data | `VISUAL_DATA_POINTS` rows; **Use this data** tab with runnable SQL; AI_EXTRACT snippet asks before Run | AI_EXTRACT only |
| Close | Bring 20 pages: upload (uncheck OCR/LAYOUT for one AGENTIC page) or `scripts/preflight.py` | yes |

## Onboarding

First visit shows a welcome once per browser (**Take the tour** / **Skip**). The tour is built into the app, 12
steps in storyline order including the value panel and the Use this data tab, no agent call, nothing billed.
Asking the agent "give me a tour" starts the same tour; "explain this screen" tours the current screen only.
**New chat** clears the conversation; **Reset demo** also clears uploads.

## Evals and tests

Last agent eval and the cross-account cold starts (US East 1, US West 2): `docs/model-eval.md`, `TESTING.md`.
Without the docs tool (`DOCS_SEARCH=0`) the two docs-dependent eval cases are skipped by design.
