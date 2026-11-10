# Agentic Parse Demo

A customer-facing demo of AI_PARSE_DOCUMENT agentic mode, with an on-screen agent that explains the documents, the parse results, and the demo itself.

## Documents

**Document**:
A single file (PDF, PPTX, DOCX, or image) placed on the demo stage, either shipped with the corpus or uploaded during a session.
_Avoid_: File, asset

**Corpus**:
The fixed, reproducible set of synthetic Documents shipped with the demo.
_Avoid_: Sample docs, dataset

**Control Document**:
A text-only Document in the Corpus that shows where agentic mode adds nothing over LAYOUT.
_Avoid_: Baseline doc

**Uploaded Document**:
A Document added through the app during a session, outside the Corpus.
_Avoid_: User file, ad-hoc doc

**Ground Truth**:
The known-correct values a Document was generated with (chart values, table cells, stamp text, checkbox states).
_Avoid_: Expected output, answer key

**Channel**:
Whether a Ground Truth Visual is an embedded image (detectable by AGENTIC as a Visual) or vector text (scored from each Parse Mode's text output).
_Avoid_: Source, kind

**Role**:
What an image-channel Visual depicts when its image_type is generic, such as logo, stamp or signature.
_Avoid_: Subtype

## Parsing

**Parse Mode**:
One of OCR, LAYOUT, or AGENTIC, as accepted by AI_PARSE_DOCUMENT.
_Avoid_: Engine, setting

**Parse Run**:
One execution of AI_PARSE_DOCUMENT on one Document in one Parse Mode, with its stored result.
_Avoid_: Job, extraction

**Visual**:
A chart, table, diagram, photo, or other non-text element that agentic mode detects, with a bounding box, type, summary and details.
_Avoid_: Image, figure, element

**Mode Comparison**:
The side-by-side view of the three Parse Runs of one Document, scored against its Ground Truth.
_Avoid_: Diff, benchmark

**Live Result** / **Cached Result**:
A Parse Run executed in this session, versus one replayed from storage.
_Avoid_: Fresh, stale

## Agent

**Demo Agent**:
The Cortex Agent on screen that answers questions about Documents, Parse Runs, the demo design, and Snowflake documentation, and can trigger Parse Runs.
_Avoid_: Bot, assistant, copilot

**Design Docs**:
The demo's own README, architecture notes and ADRs, indexed so the Demo Agent can explain how the demo works.
_Avoid_: Repo docs

**Cost per correct fact**:
Measured AI credits per page for a Parse Mode, times the pages in the scored Corpus, divided by the Facts (image and text) that Mode found against Ground Truth. Computed from stored data by `VALUE_STORY`. It ignores the Facts a Mode missed, so it favours cheap Modes; read it next to pages to check by hand (pages where the Mode missed any Ground Truth Fact).
_Avoid_: ROI, price per fact

**VISUAL_DATA_POINTS**:
A view with one row per chart value AGENTIC read: Document, page, Visual id, Mode, chart title, series, label, value, unit. Built from the latest AGENTIC Parse Run of each Document; OCR and LAYOUT have no rows because they report no Visuals.
