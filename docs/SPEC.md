# Spec: Agentic Parse Demo

## Problem Statement

Snowflake SEs need to show customers what AI_PARSE_DOCUMENT AGENTIC mode (Public Preview, released 2026-10-28) does that OCR and LAYOUT do not: understanding charts, diagrams, stamps, forms, photos and scanned pages. None of our existing demo repos contain visual documents; every committed PDF is digital text-only, so they cannot demonstrate the difference. Customers also ask "how good is it, what does it cost, and how would I build this", which a static slide cannot answer credibly, and the feature's own doc example (`PARSE_JSON(AI_PARSE_DOCUMENT(...))`) does not compile on current accounts.

## Solution

A reusable, industry-neutral demo: a Next.js app on Snowflake App Runtime that shows a synthetic visual Corpus parsed in all three Parse Modes side by side, with bounding boxes over each detected Visual, scored against Ground Truth, with measured cost. Presenters (or customers driving the screen) can upload their own Document and watch it parse. A Demo Agent on screen answers questions about the Documents, the Parse Runs, the demo's own design, and the Snowflake docs, and can trigger re-parses and comparisons itself. Every Parse Run is stored (ADR 0001), so the demo survives preview regressions and shows Live vs Cached Results honestly.

## User Stories

1. As a presenter, I want a Corpus of realistic synthetic visual Documents, so that I can demo without customer data.
2. As a presenter, I want each Corpus Document to stress one visual capability (charts, stamps/signatures, forms/checkboxes, diagrams, scanned/skewed pages, multi-page tables, slides, phone photos), so that each makes one clear point.
3. As a presenter, I want a Control Document, so that I can honestly show where LAYOUT is enough.
4. As a presenter, I want every Corpus Document to carry Ground Truth, so that accuracy claims are measured, not eyeballed.
5. As a maintainer, I want the Corpus generated deterministically from a seed, so that it can be regenerated or extended per industry.
6. As a presenter, I want the generated Corpus committed, so that the demo runs without Python setup.
7. As a presenter, I want every Corpus Document parsed in OCR, LAYOUT and AGENTIC, so that the Mode Comparison is ready instantly.
8. As a presenter, I want a document list showing each Document, its type, page count and parse status per mode.
9. As a presenter, I want to view a Document's pages rendered in the browser, so that the audience sees the original.
10. As a presenter, I want bounding boxes drawn over each Visual AGENTIC detected, so that the audience sees what it found.
11. As a presenter, I want to click a box and see the Visual's type, summary and structured details next to its Ground Truth, so that I can show accuracy per Visual.
12. As a presenter, I want the three Parse Modes' outputs side by side for the same page, so that the difference is obvious.
13. As a presenter, I want a per-mode accuracy score against Ground Truth, so that I can quantify the improvement.
14. As a presenter, I want measured cost per page per mode, labelled with the date and "measured on this account", so that cost answers are real.
15. As a presenter, I want a "pending" cost state while usage telemetry lags, so that I never show a made-up number.
16. As a presenter, I want to upload a PDF, PPTX, DOCX or image, so that a customer can try their own Document.
17. As a presenter, I want uploads to auto-parse in the selected mode(s) with progress, so that it feels live.
18. As a presenter, I want a Run button to re-parse any Document in any mode, so that I can show a Live Result on demand.
19. As a presenter, I want upload limits (about 10 MB, about 20 pages, PDF/Office/images), so that a live demo cannot run up surprise cost by accident.
20. As a presenter, I want Uploaded Documents to become searchable by the Demo Agent shortly after parsing, so that I can ask about them.
21. As a presenter, I want a Live vs Cached badge on every result, so that I am honest about what ran now.
22. As a presenter, I want failed Visuals (`description: error`) shown explicitly, so that preview behaviour is transparent.
23. As a presenter, I want an on-screen Demo Agent chat, so that the audience can interrogate the demo.
24. As an audience member, I want to ask what is in a Document, so that I understand it without reading it.
25. As an audience member, I want to ask why AGENTIC parsed a chart differently from LAYOUT, so that I understand the feature.
26. As an audience member, I want to ask aggregate questions across extracted data (e.g. totals by vendor), so that I see analytics on documents.
27. As an audience member, I want to ask how the demo is built, so that I can picture building it myself.
28. As an audience member, I want to ask about AI_PARSE_DOCUMENT syntax, limits and pricing, with doc links, so that answers are authoritative.
29. As a presenter, I want the Demo Agent to re-parse a Document or page in a chosen mode on request, so that the agent visibly acts.
30. As a presenter, I want the Demo Agent to run a Mode Comparison on request and explain it, so that the agent does the analysis.
31. As a presenter, I want the Demo Agent to report measured cost on request.
32. As an audience member, I want every agent answer cited to Document and page, with a click that jumps the viewer there, so that answers are verifiable.
33. As a presenter, I want the agent to say plainly that AGENTIC mode accepts no user prompt, so that we never over-claim.
34. As a presenter, I want the same Demo Agent available in Snowflake Intelligence, so that customers see it outside the custom app.
35. As a presenter, I want the app restricted to the app's Snowflake role, so that no customer logins are needed.
36. As a maintainer, I want the agent model chosen by eval (latest Sonnet, falling back to latest Opus), so that quality is evidenced.
37. As a presenter, I want a runbook and talk track, so that any SE can deliver it.
38. As a maintainer, I want each stage independently checkable, so that John can verify as we go.
39. As a presenter, I want to ask the Demo Agent to show something ("show me the moisture heatmap", "go to page 4", "compare this page against OCR", "zoom in on the pie chart") and have the viewer switch Document, page, view, mode pair, selected Visual and zoom for me, so that the demo is driven by conversation.
40. As an audience member, I want the viewer to follow the Demo Agent's answer to the page it cites, so that I see the evidence without clicking.
41. As a presenter, I want the Demo Agent's app actions validated against a fixed action list and target catalog, so that it can never navigate anywhere unexpected.
42. As a presenter, I want the Demo Agent to control the whole app (home, upload, mode tab, compare pair, What was missed, Compare answers toggle, theme, scrolling), never claiming it cannot when the action exists, so that the demo is fully conversation-driven.
43. As an audience member, I want the Demo Agent to explain any screen or number with a spotlight and caption, or a guided tour, grounded in the App Guide, so that I understand what AGENTIC parse adds.
44. As a presenter, I want the agent to know the app state (route, Document, 1-based page, view, panels, toggles, theme, spotlight), so that "where am I?" and "close that" just work.

## Implementation Decisions

- **Account and namespace:** the author's demo account, `SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO`, warehouse `SFE_AGENTIC_PARSE_DEMO_WH` (XSMALL; docs recommend no larger than MEDIUM). Private repo `sfc-gh-jkang/agentic-parse-demo`.
- **Corpus generator:** Python (reportlab + matplotlib + Pillow), extending the reportlab approach in `ap-invoice-processing-demo`. Deterministic from a seed. Emits `<doc>.<ext>` + `<doc>.truth.json` per Document. The scanned Document is rendered to image, skewed and noised, then re-wrapped as PDF. Phone-photo images are rendered with perspective and lighting distortion.
- **Ground Truth shape:** per Document, a list of expected Visuals (`page`, `image_type`, `title`, and type-specific values such as chart series points, table cells, stamp text, checkbox states).
- **Storage (ADR 0001):** `DOCUMENTS` (path, source = corpus|upload, type, pages), `PARSE_RUNS` (run id, document, mode, options, raw OBJECT result, live flag, started/finished, error), and flattened views `PARSE_PAGES` and `PARSE_VISUALS` (from `pages[].images[]` and top-level `images[]`).
- **AI_PARSE_DOCUMENT usage:** use `:` path access on the returned OBJECT; never `PARSE_JSON` (doc example fails to compile with `Invalid argument types for function 'PARSE_JSON': (OBJECT)`). Always pass `return_error_details => TRUE`. Never pass `extract_images` with AGENTIC.
- **Procedure seam (primary interface):**
  - `PARSE_DOCUMENT(path, mode, page_filter?)` → run id; writes a Parse Run.
  - `COMPARE_MODES(document)` → per mode: Visuals found, matched to Ground Truth, accuracy score, chars, tables.
  - `PARSE_COST(document?)` → measured credits per page per mode, or pending.
  Used identically by the app routes and the Demo Agent's custom tools.
- **Scoring:** match detected Visuals to Ground Truth by page and bounding-box overlap or type, then score per field (numeric values within tolerance, text by normalized match). OCR and LAYOUT score on whether the values appear in their text output.
- **Cost:** measured from Snowflake's AI function usage history view (exact name confirmed from docs during Stage 2), never hardcoded.
- **App:** Next.js on Snowflake App Runtime (Snowflake Apps template). Routes: list documents, get document + runs, upload (stage PUT → `PARSE_DOCUMENT`), run, compare, cost, agent (SSE proxy). pdf.js renders pages; bounding boxes overlay using the AGENTIC coordinates. Markdown rendering via react-markdown + remark-gfm with transpilePackages and restored Preflight styles. SSE parser handles all Cortex Agent event types including `error`.
- **Search:** Cortex Search service over `PARSE_PAGES` content + Visual summaries (attributes: document, page, mode); second service over Design Docs (README, ADRs, GLOSSARY, SPEC); existing `CKE_SNOWFLAKE_DOCS_SERVICE` for Snowflake docs. Upload triggers a search refresh.
- **Analyst:** semantic view over extracted Visual data and Document metadata.
- **Demo Agent:** Cortex Agent with tools: parsed-documents search, design-docs search, Snowflake docs search, Cortex Analyst, and custom tools re-parse / compare / cost. Model pinned to latest available Sonnet; switch to latest Opus if Stage 4 eval falls short (John's call, overriding the `orchestration: auto` default). Instructions require citations and state that AGENTIC mode accepts no prompt. Also published to Snowflake Intelligence.
- **App control by the Demo Agent (T18, 2026-10-31):** `control_viewer` was replaced by `control_app` / `CONTROL_APP`: 17 validated actions with combinable optional fields, 1-based pages, a fixed spotlight target catalog (`data-tour` attributes), highlight and tour (steps as a JSON string, since generic warehouse tools reject arrays), and an `[App state: ...]` line on every message. Explanations come from docs/app-guide.md via design_docs search. The bullet below records the original T10 decision.
- **Viewer control by the Demo Agent (added 2026-10-30):** a custom tool `control_viewer` backed by a side-effect-free SQL procedure that validates and echoes a viewer action as JSON (`action`: navigate | select_visual | close_visual | set_view | set_pair | zoom; fields `doc`, `page`, `view` one|compare, `pair` LAYOUT|OCR, `visual`, `zoom` fit_width|fit_page|percent). Unknown Documents or pages are rejected by the procedure. The app applies the action from the agent's SSE stream to the same viewer state the controls use, and ignores anything it cannot apply. Agent instructions: call it whenever the user asks to see or show something, and when an answer cites a page. Custom tools: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-manage ; streaming: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-run . Risk: the tool result's presence in the stream is not yet verified live; T10 starts with a spike, with a fallback of a fenced action block in the agent's reply parsed by the app.
- **Access:** app restricted to a demo role; role holds `SNOWFLAKE.CORTEX_USER`.
- **Guardrails:** upload size/page/type limits enforced server-side (no parse budget: dropped as over-engineering for a demo).

## Testing Decisions

- Good tests check external behaviour only: given a Document and mode, the stored Parse Run and the comparison output; never internal helper functions or React internals.
- **Seam 1, procedures (primary):** pytest against a live scratch schema on the author's demo account: parse → stored run → flattened Visuals → `COMPARE_MODES` scores → `PARSE_COST` pending/measured. Includes a regression test that the `PARSE_JSON` form is not used anywhere.
- **Seam 2, generator:** pytest that output is deterministic for a seed and that Ground Truth matches what was drawn.
- **Seam 3, end to end:** one Playwright run on the deployed app: upload, three modes complete, click a Visual box, ask the agent a question, get a cited answer.
- **Agent eval:** a native Agent Evaluation dataset (~20 questions) scored on answer correctness and tool selection, run for Sonnet and Opus.
- **Audits before sharing:** Architecture Claim Audit (objects are what we claim, serving code hits them, QUERY_HISTORY proves it), Executable Content Audit (every snippet in README/runbook executed), Citation Audit (every figure has a checkable source).
- Prior art: `legal-doc-ai-demo` (AI_PARSE_DOCUMENT cost modes, search, agent), `ap-invoice-processing-demo` (generators, ground truth, benchmark), `document_extract_cowork` (Next.js agent route).

## Stages (each ends with a check by John before the next starts)

1. Corpus and Ground Truth. Check: open the documents.
2. Parse core in Snowflake: objects, procedures, full Corpus parsed in 3 modes, comparison, measured cost. Check: one worksheet query plus the accuracy/cost report. Go/no-go on the story.
3. App without agent: viewer, boxes, comparison, upload, Run button, deployed. Check: click through the live URL and upload a Document.
4. Demo Agent: search services, semantic view, custom tools, Sonnet vs Opus eval, Snowflake Intelligence. Check: ask 10 questions and review the eval.
5. Agent in app, Playwright test, audits, runbook. Check: full dry run.

## Out of Scope

- Customer-specific document sets (the generator makes these possible later).
- Customer logins or multi-tenant access.
- AI_EXTRACT fine-tuning; AI_EXTRACT appears only as one optional chained step.
- Production ingestion pipelines (streams, tasks, dynamic tables).
- Making the repo public (requires the open-source-repo audit).

## Further Notes

- Sources: https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode , https://docs.snowflake.com/en/sql-reference/functions/ai_parse_document , https://docs.snowflake.com/en/release-notes/2026/other/2026-10-28-ai-parse-document-agentic-mode-preview , pricing https://docs.snowflake.com/en/user-guide/snowflake-cortex/pricing
- AGENTIC per-page rate is not published in the docs; it is measured in Stage 2.
- The two docs pages disagree on `extract_images` with AGENTIC (NULL vs error); we never set it.
