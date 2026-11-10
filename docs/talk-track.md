# Talk track (10 to 12 minutes)

For any SE. Run the [runbook](runbook.md) first. The order is deliberate: payoff first, then how it got there, then the agent choosing its own steps, then its limits, then the one thing that costs money, then proof. Everything after Beat 2 can be dropped if time runs short, except the Value beat (it answers the first question a buyer asks) and the Data beat. Numbers come from `docs/stage2-report.md` (accuracy, from stored Parse Runs), `PARSE_COST` (cost) and `docs/model-eval.md` (agent eval); docs/audits.md traces each one. The chips in the empty chat are these questions verbatim, in this order, and `tests/test_storyline_consistency.py` fails if the words drift.

Setup state before you start: the home page, chat closed, Compare answers across modes on (default), light theme. Click `quarterly_report`, then **Ask the Demo Agent**.

For someone new to the app, skip the talk and use **Take the tour** in the header (also offered once on a first visit, and by asking the agent "give me a tour"): twelve steps in the same order as this track (including the value panel and the Use this data tab), no agent call, nothing billed. **New chat** in the chat header starts a clean conversation; **Reset demo** clears it too.

## Opening payoff (1.5 min)

Click: the first chip, or type: "In quarterly_report, what was Q3 revenue on the revenue chart?"

On screen: the agent answers with a page citation; under it the Compare answers table has three rows. AGENTIC: 13.8 million USD (p. 1). LAYOUT: Not found. OCR: Not found. Each row shows its latency.

Say: "Same question, same model, three parses of the same PDF. The number lives in a picture, and only one parse contains it. Now let me show you how it got there." Then one line of framing: AI_PARSE_DOCUMENT has had OCR and LAYOUT for a while; AGENTIC mode is new (Public Preview, 2026-10-28); one SQL function, three modes, results stored in tables, a Cortex Agent on top, a web app on Snowflake App Runtime; the documents are synthetic, so we know the right answers. Be honest up front: **AGENTIC accepts no prompt or schema.** You cannot tell it what to extract; you get what it finds.

Fallback: if the agent is slow, point at the Cached Result in the viewer (the number is in the stored AGENTIC parse) and ask the question again; if the Compare table is empty, the answer is in the agent text and the table is a bonus. No number on this screen depends on a live call.

Docs: https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode , https://docs.snowflake.com/en/release-notes/2026/other/2026-10-28-ai-parse-document-agentic-mode-preview

## Value beat (1.5 min)

Click: the second chip, or type: "Why does AGENTIC matter, and is it worth the cost?" Then the third chip, "If review takes 5 minutes a page at $60/hour, what does 50,000 pages a month cost?"

On screen: the app goes home and spotlights the **What AGENTIC is worth** panel; the agent answers from the stored data (the `value_story` tool, never a figure typed into a prompt). Per Parse Mode: measured credits per 1,000 pages (OCR 0.68, LAYOUT 3.66, AGENTIC 8.18), facts found of 494 (472, 416, 488), relations found of 125 (59, 85, 123), pages a person would still check by hand of 24 (15, 14, 6) and **credits per correct fact**: cost per correct fact = measured credits per page x 24 pages, divided by facts found. OCR 0.0000346, LAYOUT 0.000211, AGENTIC 0.000402: OCR is the cheapest per fact, 11.6 times cheaper than AGENTIC. Hover a figure or open "How cost per correct fact is computed" to show the arithmetic.

Say: "Per fact, AGENTIC is not cheaper; OCR is. What AGENTIC buys is that far fewer pages need a person: 6 of 24 against 14 or 15, and 123 of 125 relations against 59 or 85. And on a plain contract like control_contract OCR finds everything, so do not pay 12 times more per page there. Route the hard pages to AGENTIC." The routed figure (OCR everywhere plus AGENTIC on the 17 pages OCR or LAYOUT missed facts on: 0.155 credits against 0.196 for AGENTIC on all 24) is an oracle estimate: it assumes you know the hard pages in advance. If asked for volume, type 50,000 into **Pages per month** (or ask "What would 50,000 pages a month cost?"): AGENTIC 409 AI credits, LAYOUT 183, OCR 34, with the expected facts recovered beside each, labelled an estimate from measured rates on this corpus.

The headline row is **pages to check by hand** and **relations found**; credits per correct fact stays on screen but secondary. Say: "On cost per fact OCR wins, so the honest question is what a page left to check costs you. Tell me your own numbers." The third chip does that with the sample assumptions 5 minutes a page and $60 an hour (the audience's own numbers, not ours): at 50,000 pages a month AGENTIC leaves 12,500 pages to check, about 1,042 review hours and 62,500 of review cost; LAYOUT 29,167 pages, 2,431 hours, 145,833; OCR 31,250 pages, 2,604 hours, 156,250. AGENTIC saves about 1,389 hours against LAYOUT and 1,563 against OCR, while using 409 AI credits against 183 and 34. Credits are shown as credits: the panel and the agent convert them to money only if the audience enters a **price per credit** (optional box), never one we pick. Say these are the audience's assumptions applied to rates measured on this corpus, an estimate, not a quote.

Fallback: the panel is on the home page and loads from stored data; if the agent is slow, scroll to it and read the table. The assumption boxes work by hand too.

## Beat 1: the parse is the picture (2 min)

Click: nothing yet. After the payoff answer the agent has already selected the chart on page 1 (it moves the screen to its evidence), so its detail is open. Point at it, then click the amber chart box to close it and look at the score strip.

On screen: the chart's series as a table next to Ground Truth with a field match count. The strip scores each Parse Mode against Ground Truth: on this Document AGENTIC finds 30 of 31 image facts and pairs 13 of 13 values with their labels (3 of 3 Visuals detected); OCR finds 25 of 31 facts but pairs only 1 of 13; LAYOUT finds 4 of 31 and pairs 0 of 13 (OCR and LAYOUT show Visuals n/a: they report none). Corpus totals for relations (a value with its label, edge or row): AGENTIC 123/125, LAYOUT 85/125, OCR 59/125.

Say: "OCR reads most characters but loses which number belongs to which bar. That pairing is what the extra spend buys." Then the one sentence that keeps the audience from merging two ideas: "'Agentic' means two different things in this demo. AGENTIC parse mode means the AI_PARSE_DOCUMENT function itself selects processing actions and routes models for each visual element inside one SQL call (docs: 'manages action selection, prompting, model routing'). The chat agent you will see next is a separate Cortex Agent whose LLM chooses among tools to answer you." (https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode)

Fallback: if the chart detail is not open, click the amber chart box; if that does nothing, click **Compare modes**, **AGENTIC vs OCR** and read the score strip; the contrast is the same.

## Beat 2: the agent drives the app toward a goal (3 min)

This is the headline. Do not start with voice navigation; that reads as a remote control. Start with a goal no single tool can answer.

Click: **Home** (so the audience sees the screen move), then the second chip, or type: "Which Document does AGENTIC beat LAYOUT on by the most Facts inside images? Show me its scores first, then find the page where those Facts are, and highlight the result on screen."

On screen: the status line, then the agent's answer naming `quarterly_report` (AGENTIC 30 vs LAYOUT 4 image facts found, a gap of 26; next are claim_packet 16, floor_plan_diagram 13, pitch_deck 11), the app opens that Document at the page and spotlights the score strip with a caption quoting the numbers. Open **How I answered**: it lists, in order, what the agent did in plain language (a scores lookup across Documents, the Mode scores for that Document, a search of the parsed pages, moving the screen), with its reasoning where the platform sends it. Collapsed by default.

Say: "I did not write that sequence. It looked up which Document wins, checked that Document's scores, searched the pages for where the facts are, then moved the screen. If I ask a different question, a different sequence comes back." This is the answer to 'it is just a workflow with a chat box'. Aside (10 seconds, optional): "It can also do the small things by voice: 'go to page 3', 'show me what LAYOUT sees', 'give me a tour of this screen', 'switch to dark mode'. All of it is one tool, `control_app`, which only validates and echoes JSON; the app applies it."

Fallback: if the chain stalls past about 40 s, open **How I answered** while it runs (the steps stream), then ask the shorter "Which parse mode scored best on relations across the corpus?". If the screen did not move, say so and click to the page yourself; the cited answer is still correct.

## Beat 3: it knows its limits (1.5 min)

Click: the third chip, or type: "What was the stamped invoice's total in Japanese yen, and how many credits did the 2025 parse runs use?"

On screen: it refuses the parts it has no data for instead of inventing a yen figure or a credit count. Then open `claim_packet`, click **What was missed**: AGENTIC detected and typed 15 of 28 Visuals; logos, signatures and sticky notes are listed. Then open `control_contract` and compare AGENTIC vs LAYOUT: there is nothing visual to win, LAYOUT is enough and cheaper.

Say: "A demo that only shows wins is a brochure. It misses some Visuals, and on plain text you should use LAYOUT." If asked what 54% means: a Visual counts only when AGENTIC reports a box of the right type overlapping the drawn box (IoU at least 0.3) on the same page. It is a strict detector test, not a reading test: AGENTIC still reads 238/244 facts inside images. OCR and LAYOUT show n/a because they report no Visuals, not because they scored zero (docs/app-guide.md, "Why Visuals detected is 15/28").

Invite one audience question here: "Ask it something about these Documents." If nothing comes, use: "In floor_plan_diagram, what does Panel P1 connect to, and by what kind of link?" (Rack R1, power).

Fallback: if the trap answer is long, read the first sentence. If What was missed is empty for the Mode shown, switch the Parse Mode to AGENTIC.

## Beat 4: it asks before it spends (1.5 min)

Click: the fourth chip, or type: "Re-parse receipt_photo in AGENTIC mode."

On screen: the app opens `receipt_photo` first (the URL changes to `/documents/receipt_photo`), so the audience sees the Document being discussed. The agent does NOT re-parse yet. It states the Document, its page count (1), the Mode, and the cost as a sum from measured usage: 1 page at the measured AGENTIC rate of 8.18 AI credits per 1,000 pages, about 0.008 AI credits (a calculation from measured usage, not a quote), and asks you to reply yes or no.

Say: "It asked before it spent." Then pick: type **yes** to run it live: a banner marks the billed parse, the viewer opens `receipt_photo` in AGENTIC with a **Live Result** badge and the new scores (about 30 s, 189 s cold has been seen). Or type **no** and show it cancels. Only a bare yes, confirm or go ahead confirms the Document and Mode it just proposed.

Fallback: if the live parse is slow, keep talking, switch to a Corpus Document (results are labelled **Cached Result**: same function, stored earlier) and come back. Note a reparse stores one more Parse Run for a Corpus Document; **Reset demo** removes uploads, not this run (runbook).

## Beat 5 (cuttable): proof and build (2 min)

Click: the **Show eval results** chip (or **Eval results** in the chat header).

On screen: a dialog over the page (not inside the chat scroll) with the date, models and pass counts of the last agent eval, and a tool-order table: for the multi-step question the expected order (parse_analytics > mode_scores > parsed_documents > control_app), the order score, number of calls and repeats. The panel is generated by `scripts/eval_agent.py` from `docs/model-eval.md`; say the date out loud.

Say: "We do not grade the answer only; we grade the path: right tools, right order, no repeated calls." Then measured cost: OCR 0.68, LAYOUT 3.66, AGENTIC 8.18 AI credits per 1,000 pages, measured on this account from `CORTEX_AI_FUNCTIONS_USAGE_HISTORY`; AGENTIC is about 2.2x LAYOUT and 12x OCR per page. Compare answers cost about 0.006 AI credits per question (150 calls averaged 0.0021 each). Architecture in four lines: one procedure seam (`PARSE_DOCUMENT`, `COMPARE_MODES`, `PARSE_COST`) used by the app and the agent; every Parse Run stored as the raw OBJECT, views flatten pages and Visuals; Cortex Search (parsed documents, design docs, the shared Snowflake docs service), a semantic view for Cortex Analyst, custom tools; one agent for the web app that can drive the screen and a twin without the screen tool listed in Snowflake Intelligence. Traces for a real run: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-monitor . Native agent evaluations: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-evaluations (this demo uses its own runner, `scripts/eval_agent.py`).

Gotcha worth sharing: the docs example wraps the function in `PARSE_JSON`, which does not compile because it already returns an OBJECT; use `:` path access.

Close it with **Close eval results**. Fallback: if the panel is not there, `docs/model-eval.md` has the same tables.

## Data beat: every chart value is now a row (1.5 min)

Click: the last chip, or type: "Compare Q3 revenue across the reports."

On screen: the agent answers with a table from the view `VISUAL_DATA_POINTS` (one row per chart value AGENTIC read: Document, page, chart, series, label, value, unit; 31 values across the Corpus, 13 of them on quarterly_report; Q3 revenue is 13.8 million USD), and the app opens the **Use this data** tab on quarterly_report. That tab has runnable SQL: its pages, its visuals as rows, a Cortex Search query, an AI_EXTRACT example and a Dynamic Table pattern. **Run** the visuals snippet to show the rows. The AI_EXTRACT snippet is billed per token: Run shows its size and asks first. The Dynamic Table snippet is a pattern, not run here.

Say: "Every chart value is now a row. It is in the same semantic view the agent uses, so you can plot it, join it, or ask about it across reports." Ask "Give me the SQL" to get the snippet in the chat with its docs link.

Fallback: if the agent is slow, click **Use this data** on a Document and run the visuals snippet; the rows come from a view over the stored Parse Runs.

## Close: bring 20 of your pages (1 min)

Say: "Use AGENTIC where the meaning lives in the picture, LAYOUT or OCR where it is text, and let an agent you can audit decide which to read. Next step: bring 20 of your own pages."

Click: go home, **Choose a file** (a one-page PDF or the customer's own, within 10 MB / 20 pages). Uncheck OCR and LAYOUT to keep it to one billed AGENTIC page, about 0.008 AI credits. Progress rows show elapsed seconds; the viewer opens with a **Live Result** badge. Afterwards ask: "What total amount is stated in the uploaded document <doc id>? Cite it." For a customer's file the day before, use `scripts/preflight.py` (runbook).

Fallback: if the upload is slow, say the next step is theirs and move on; Corpus results are Cached.

## Objections

| Objection | Answer on screen |
|---|---|
| "It's just a workflow with a chatbot on top" | Beat 2: **How I answered** shows a model-chosen, multi-tool path; the order changes with the question; Beat 5 grades the tool order. |
| "It hallucinates" | Beat 3 refusal; every answer cites a Document and page; scores are against Ground Truth; Compare shows "Not found" rows. |
| "What about control?" | Beat 4: states cost and waits for yes; the screen tool only accepts a fixed action list; the agent has a 120 s / 32k token budget. |
| "Cost?" | Cost strip on home and Beat 5: measured credits per 1,000 pages; about 0.006 AI credits per Compare question. |
| "Is AGENTIC mode really agentic?" | Beat 1 sentence: managed per-visual action selection and model routing inside one call; no goal or prompt input. Do not overclaim. |
| "Was that rehearsed?" | Invite an audience question in Beat 3; the Live badge and the **How I answered** list show the real run. |
| "Governance?" | Runs under role RBAC in Snowflake, results in tables, the same agent (without the screen tool) is listed in Snowflake Intelligence. |

## Backup questions

Each passed in the agent eval (`docs/model-eval.md`):

1. "What is the invoice number on the stamped invoice and who is it billed to?"
2. "What was Q4 revenue in the quarterly report's revenue bar chart?"
3. "Show me page 2 of claim_packet in compare view against OCR" (the app moves by itself)
4. "Which parse mode scored best on relations across the corpus?" (Cortex Analyst over the semantic view)
5. "What are the measured AI credits per 1000 pages for OCR, LAYOUT and AGENTIC?"
6. "Can I give AI_PARSE_DOCUMENT AGENTIC mode a custom prompt or schema to steer it?" (it says no)
7. "Why does the demo store every Parse Run instead of calling AI_PARSE_DOCUMENT on each page view?" (this repo's design docs)
8. "According to the Snowflake documentation, what does AI_PARSE_DOCUMENT AGENTIC mode do?" (Snowflake docs search)
9. "give me a tour of this page" (a 4 to 8 step guided tour from docs/app-guide.md; Next, Back, Close, Esc)

Other Compare answers examples, verbatim from the live app on 2026-10-31 and matching `corpus/*.truth.json`: floor_plan_diagram Panel P1 (AGENTIC: Rack R1 via a power link; LAYOUT and OCR Not found); quarterly_report active customers in March (1,990; others Not found); floor_plan_diagram AHU-1 (Storage room, duct serves the Server Room; others Not found); inspection_form 'Guard in place' (unchecked in every mode, the fairness example). Be honest that the receipt total, the claim_packet sticky note and the rate card are answered by all three modes, and the stamped invoice's PAID stamp by AGENTIC and OCR but not LAYOUT: OCR reads text inside images well; AGENTIC's edge is structure (which value belongs to which bar, which box connects to which).
