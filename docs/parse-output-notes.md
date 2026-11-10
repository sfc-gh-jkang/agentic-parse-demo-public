# AI_PARSE_DOCUMENT output, as observed live

Observed on the author's demo account (AWS US East 1) on 2026-10-30 against the Corpus. Docs: https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode and https://docs.snowflake.com/en/sql-reference/functions/ai_parse_document. AGENTIC mode is in preview; re-check before relying on any of this.

- The function returns an OBJECT. The documentation examples wrap it in `PARSE_JSON(...)`, which fails to compile here with `Invalid argument types for function 'PARSE_JSON': (OBJECT)`. Use `:` path access.
- With `return_error_details => TRUE` the result is `{error, metadata:{pageCount, processedPageCount}, value:{...}}`.
- Paged files with `page_split` return `value:pages[]`, each with `index`, `content`, `dimensions:{width,height}` in pixels (1700x2200 for US Letter) and `images[]`.
- Image files (PNG, JPG) are parsed without `page_split` and return `value:content` plus a top-level `value:images[]`, with no dimensions.
- Visual bounding boxes are page pixels, not 0-1 coordinates.
- The `results` shape depends on `image_type`: chart, table and diagram return `summary` plus `details`; `other` returns `description` plus `visible_text`; `photo_with_text` returns `scene_description` plus `visible_text`.
- Chart `series[].points` use `{label, value}`, plus a `key_values` list of readable strings.
- Diagram `details.connections` refer to component `id`s, not labels.
- A whole-page scan or photo is read as page text; it is not reported as a Visual.
- Small decorative images (logos, signatures, a sticky note) were often not reported as Visuals.
- LAYOUT and AGENTIC both transcribe checkboxes as `☐` / `☑`; OCR emits bare `X` or `V` marks or nothing.
