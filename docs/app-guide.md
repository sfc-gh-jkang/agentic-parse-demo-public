# App Guide

What every screen and every element of the Agentic Parse Demo app shows, how to read it, and why it matters for the value of AI_PARSE_DOCUMENT AGENTIC mode. The Demo Agent explains the app from this guide and spotlights elements by the target name given in each heading (control_app `highlight` and `tour`). Pages are counted from 1 everywhere on screen.

## Two meanings of "agentic"

AGENTIC parse mode is the AI_PARSE_DOCUMENT function choosing processing actions and models per visual element inside one SQL call (https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode); the chat Demo Agent is a different thing, a Cortex Agent whose LLM chooses among tools to answer you, and its "How I answered" panel shows those tool steps.

## Screens

The app has two screens and one panel that is always there.

- **Home** (`/`): measured cost per Parse Mode, the upload card and the Document list.
- **Document** (`/documents/<id>`): one Document, its page image on the left and its parsed text on the right, with scores against Ground Truth.
- **Chat panel**: the Demo Agent, bottom right on every screen. It answers questions, drives the app (open, switch, compare, zoom, highlight, tour) and can re-parse a Document after you confirm.

## Home screen

### cost_stats: measured cost

The row of cards at the top. Documents in Corpus and Pages count what is loaded. The three AI credits / 1k pages cards are **measured** on this account from Snowflake usage telemetry, not list-price estimates: one card each for AGENTIC, LAYOUT and OCR. "pending" means usage telemetry has not reported yet for that Mode. Why it matters: AGENTIC costs more per page than LAYOUT or OCR; the rest of the app shows what that extra spend buys (charts, stamps, diagrams and photos understood, not just read).

### upload_card: Upload a Document

Drop a PDF, image or Office file, or press Choose a file. The app stages it, parses it live with AI_PARSE_DOCUMENT and opens it with a **Live Result**. Uploaded Documents have no Ground Truth, so they get no scores; they become searchable by the Demo Agent once parsed in AGENTIC mode. Why it matters: it proves the result on the customer's own document, not only on the synthetic Corpus.

### value_panel: What AGENTIC is worth

Below the measured cost on the home screen (also reachable from **Value of AGENTIC** on any Document page). One row per Parse Mode with the measured AI credits per 1,000 pages, facts and relations recovered against the answer key, the pages a person would still check by hand (pages where the Mode missed any answer-key fact), and **credits per correct fact**. Cost per correct fact = measured credits per page x pages in the scored Corpus, divided by facts found; hover a figure or open "How cost per correct fact is computed" for the arithmetic. Everything is computed from stored data and the unfavourable numbers stay in: OCR is cheapest per fact, AGENTIC leaves the fewest pages to check by hand and recovers the most relations. The panel also names the Documents where a cheaper Mode matched AGENTIC (the control Document) and recommends routing the hard pages to AGENTIC, an oracle estimate because it assumes the hard pages are known in advance.

### volume_input: Pages per month

Type a monthly page volume (1 to 1,000,000,000). The panel shows AI credits per month and expected facts recovered per Parse Mode, labelled "estimate from measured rates on this corpus": pages x measured credits per page, and pages x facts found per corpus page. A different mix of Documents will differ. The Demo Agent can set it ("what would 50,000 pages a month cost?").

**Cost including review** (the three boxes under the volume, empty by default and labelled "your assumptions"): minutes of human review per page to check, reviewer hourly rate, and an optional price per credit. Per Parse Mode: pages to check per month = pages to check / corpus pages x volume; review hours = that x minutes / 60; review cost = hours x rate. AI credits stay credits; they become money only when you enter a price per credit (nothing is hardcoded, and this is not Snowflake pricing or a quote), and a total needs both a rate and a price. A line shows the review hours AGENTIC saves against LAYOUT and OCR; hover a figure for its arithmetic. The Demo Agent fills the boxes from a question such as "If review takes 5 minutes a page at $60/hour, what does 50,000 pages a month cost?" and says they are your assumptions.

### document_list: Documents

One row per Document: name, file type, pages, which Parse Modes have a stored Parse Run, and when it was last parsed. "Uploaded" marks an Uploaded Document. Click a name to open it. The Corpus is synthetic and reproducible, so every value has a known Ground Truth; the Control Document (control_contract) is text only and shows where AGENTIC adds nothing over LAYOUT.

### command_menu: Commands

The Commands button in the header (or Cmd/Ctrl+K) opens a palette to jump to any Document or action without the mouse.

### theme_toggle: light and dark

The sun/moon button switches light and dark themes. The Demo Agent can switch it too ("dark mode").

## Document screen

### doc_tabs: Parsed document or Use this data

The two tabs at the top right of a Document page. **Parsed document** is the viewer described here; **Use this data** is the runnable-SQL tab below.

### use_data_tab: Use this data

Runnable snippets for this Document: its pages, its chart values as rows (view VISUAL_DATA_POINTS: Document, page, visual id, mode, chart, series, label, value, unit), a Cortex Search query, an AI_EXTRACT example over the parse text and a Dynamic Table pattern for new files. **Run** executes only the read-only snippets, through a fixed allowlist (the request names a snippet and a Document, never SQL). The AI_EXTRACT snippet is billed in AI credits per million tokens: Run first shows its size and asks you to confirm. The Dynamic Table snippet is labelled "pattern, not run here" and has no Run button. Each snippet links to its Snowflake documentation page.

### page_buttons: Page

One button per page, numbered from 1. Only shown for multi-page Documents. The current page is filled.

### view_toggle: One mode or Compare modes

**One mode** shows one Parse Mode's text at a time, picked with the mode tabs. **Compare modes** shows AGENTIC side by side with LAYOUT or OCR on the same page; the two text columns scroll together. Why it matters: Compare makes the difference visible in one glance.

### mode_tabs: Parse Mode (One mode)

AGENTIC, LAYOUT, OCR. OCR is text only; LAYOUT adds tables and structure; AGENTIC also understands charts, diagrams and images. Only in One mode.

### compare_pair_tabs: Compare pair

AGENTIC vs LAYOUT or AGENTIC vs OCR. The left column is always AGENTIC (amber border). Only in Compare modes.

### score_strip: scores against Ground Truth

One row per shown Parse Mode, scored from the stored Mode Comparison for this Document:

- **Relations found**: values paired correctly with their label, edge or row, e.g. "Q3 = 13.8" from a bar chart or "Panel P1 → Rack R1" from a diagram, shown as found/total. This is where AGENTIC pulls ahead: OCR and LAYOUT often read the numbers but lose which label they belong to. Corpus totals (all 11 Documents, docs/talk-track.md): AGENTIC 123/125, LAYOUT 85/125, OCR 59/125.
- **Facts inside images**: Ground Truth facts that live inside embedded images (stamp text, photo labels, chart values) found anywhere in that Mode's text. Corpus totals: AGENTIC 238/244, OCR 222/244, LAYOUT 166/244.
- **Visuals detected**: embedded images AGENTIC detected and typed (chart, diagram, photo...) out of those expected. It reads **n/a** for OCR and LAYOUT because only AGENTIC reports Visuals at all; n/a is not a zero score.

An Uploaded Document shows "no Ground Truth to score against" instead. Hover the info icon for the Relations definition.

### what_was_missed: What was missed

Expands under the score strip. Lists, per shown Mode, each Visual not detected and each Ground Truth fact not found, with its page and channel. "Nothing missed" means a full score. Why it matters: the demo shows its misses honestly, so the scores can be trusted; AGENTIC is not a perfect detector.

### document_page: the page image

The original page, rendered from the file itself (PDF via pdf.js, or the image). Drag to pan, double-click to zoom, M for the magnifier.

### zoom_controls: zoom

Fit width, fit page, zoom out, the current percent, zoom in, magnifier. The Demo Agent can zoom from 25 to 300 percent.

### visual_box: amber boxes

Each amber box on the page is a Visual AGENTIC found, drawn at the position AGENTIC reported. Hover shows its type; click opens its detail. A dashed red box is a Visual AGENTIC detected but could not read. OCR and LAYOUT produce no boxes, because they do not report Visuals.

### visual_detail: Visual detail

Opens under a clicked amber box: AGENTIC's summary of the Visual, the text visible in it, its structured details (series, edges, labels), and how it scored against Ground Truth (matched and missed items). Close with X or Esc. Why it matters: this is the structured understanding OCR and LAYOUT cannot give.

### parsed_text: parsed text

The text the shown Parse Mode returned for this page, as markdown. In AGENTIC, Visual descriptions are inline and clickable. In Compare modes there are two columns that scroll together.

### run_button: Run

Run <MODE> re-parses this Document in that Mode with a live AI_PARSE_DOCUMENT call. It spends AI credits, records a new Parse Run and rescores it. The Demo Agent can also re-parse, but only after you confirm in a second message.

### cached_label: Cached Result or Live Result

**Cached Result · <time>** means the text was replayed from a Parse Run stored earlier: the same function and output, without paying again on every page view. **Live Result** means it was parsed in this session (Run, upload, or a confirmed agent re-parse). Why it matters: the demo is honest about what ran now versus what was stored.

## Chat panel

### chat_panel: Demo Agent

Ask about a Document's content, how the demo is built, Snowflake documentation or measured cost, or tell it what to show. Answers cite their source, e.g. (stamped_invoice, page 1) or (app-guide.md); click a citation chip to jump there. "Ask the Demo Agent" reopens a collapsed panel.

The empty chat shows the presenter questions in the order of the talk track (docs/talk-track.md): the Q3 revenue payoff, the multi-step goal, the trap question, the reparse request, and **Show eval results**. Under each agent answer, **How I answered** (collapsed) lists what the agent did in order, in plain language: its reasoning where the platform sends it (`response.thinking`), each tool call with a short summary of what it asked, and whether the call worked. It shows the real run, so the order differs between questions. The **Eval results** button in the chat header (or the chip) opens a dialog over the page with the latest committed agent eval: pass counts per model and, for the multi-step and recovery questions, the expected tool order, the order score, the number of calls and repeated calls. It is read from `web/lib/eval-summary.json`, written by `scripts/eval_agent.py` together with `docs/model-eval.md`, so the date on it is the date of that run. A billed re-parse is a two-step conversation: the agent states the Document, page count, Mode and the credit sum from measured usage, then waits for your yes. The app opens that Document on screen first.

### presenter_questions: Presenter questions

The suggested questions in the chat, in the order of the talk track. In an empty chat they sit in the open; once a conversation has started they are in the collapsed **Presenter questions** row under the messages. Clicking one asks the Demo Agent that question.

### eval_button: Eval results

The **Eval results** button in the chat header opens the latest agent eval over the page. **New chat** next to it clears the conversation (not while an answer is being written). Chat history is kept in this browser tab only, so a reload keeps it; **Reset demo** and **New chat** both clear it.

### compare_answers_toggle: Compare answers across modes

When on, each answer about a Document also asks the same question of each Parse Mode's text alone, shown in a small table under the answer. The Demo Agent can turn it on or off.

### compare_answers_table: answers per mode

Three rows, AGENTIC, LAYOUT and OCR: what each Mode's parse alone can answer, with the pages it used. A Mode that answers "not found" shows the information was not in its text. Why it matters: it turns the score strip into a concrete question the audience just asked.

## Why Visuals detected is 15/28 (54%)

What counts: the Corpus Ground Truth draws a box around every embedded image (28 across the 11 Documents: 11 "other" such as logos, signatures, stamps and sticky notes, 7 charts, 4 photos with text, 3 diagrams, 2 infographics, 1 table). A Visual counts as **detected** when AGENTIC reports a Visual on the same page, of an accepted type, whose box overlaps the drawn box by IoU (intersection over union) of at least 0.3 (`scoring/score.py`, `IOU_MATCH`). A whole-page scan or photo (`document_page`, 4 of them) is not counted: AGENTIC reads it as the page itself, and its content is scored as facts instead.

What the 54% means: AGENTIC found and typed 15 of the 28. The 13 misses (docs/stage2-report.md, What was missed): 7 small marks (2 logos, 3 signatures, a stamp, a sticky note on `claim_packet` and `stamped_invoice`), handwriting and a checks section on `inspection_form`, 2 infographics, the floor-grid figure on `claim_packet`, and the table on `multipage_rate_table`. It is a strict box-and-type test, not "did AGENTIC read the value": facts inside images are 238/244 for AGENTIC, because a value can be read from the page even when its picture is not reported as a separate Visual. What was missed lists every miss.

Why OCR and LAYOUT show **n/a**: they do not report Visuals at all, so there is nothing to match. n/a is not 0%; compare those Modes on facts and relations instead. Source: docs/stage2-report.md.

## Spotlight and tours

The Demo Agent can dim the screen around one element and add a caption (highlight), or walk through several in order (tour) with Next, Back and Close; Esc closes. The app stays usable while a spotlight is shown.

## Guided tour and welcome

A welcome message shows once per browser on the first visit, with **Take the tour** and **Skip**. The tour can be started any time from **Take the tour** in the header or from Commands. It is built into the app, so it works without the Demo Agent, is instant and never runs a billed action. It moves between pages itself and spotlights, in order: the measured cost (cost_stats), the Documents list (document_list), the score strip for quarterly_report (score_strip), the amber boxes (visual_box), one Visual's detail (visual_detail), Compare view (compare_pair_tabs), the chat (chat_panel), the presenter questions (presenter_questions), Eval results (eval_button), the value panel (value_panel), the Use this data tab (use_data_tab) and the upload card (upload_card). Each step has a caption, a step counter, Back, Next and Close; Esc closes. Asking the Demo Agent for "a tour", to "onboard me" or "how do I use this" starts the same tour (control_app `start_tour`); "explain this screen" still gives a short tour of the current screen only.
