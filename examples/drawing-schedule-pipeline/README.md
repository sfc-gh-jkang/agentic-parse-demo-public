# Drawing schedule pipeline: fixture schedules from electrical drawings, hands-off

The [large-sheet example](../large-sheet-schedules/README.md) shows why AI_EXTRACT fails on a whole 24x36 drawing and that cropping the schedule fixes it. This example runs that fix as a pipeline. You upload a drawing PDF to a stage, and Snowflake crops each schedule, extracts one row per fixture with AI_EXTRACT, and checks every catalog number against the drawing's own text. Nothing runs outside Snowflake.

## Results

Measured 2026-11-16 on an AWS US East 1 account, one run, with both drawings uploaded together:

| Drawing | Regions cropped | Fixture rows | Manufacturer correct | Catalog numbers exact |
|---|---|---|---|---|
| Synthetic 24x36 sheet from `../large-sheet-schedules` | 2 (schedule, title block) | 40 of 40 | 40 of 40, against `truth.csv` | 40 of 40 |
| A real customer lighting and panel schedule sheet (not included) | 3 (two schedules, title block) | 20 of 20 | not scored, no answer key | 19 of 20; the misread was flagged |

Upload to finished rows took about 7 minutes. That time is set by the 5 minute task schedule and the dynamic table target lag, not by the AI calls.

"Catalog numbers exact" means the extracted value appears verbatim in the PDF's text layer. On the real sheet the one miss was a single character (`Z` read as `2`), and the pipeline marked it `CATALOG_IN_TEXT_LAYER = FALSE` without being told which row was wrong.

## How it works

```
PUT drawing.pdf  ->  @DRAWINGS  (directory auto-refresh)
                        |
              DS_DRAWINGS_STREAM  ->  DS_DRAWING_TASK (every 5 min, only when new files arrive)
                        |
              DS_CROP_DRAWINGS()  Snowpark Python: crop each schedule and the title block
                        |
              @CROPS (PNG per region)  +  DS_CROP_LOG (one row per region, with its text layer)
                        |
        DT_DS_TITLE_BLOCK          DT_DS_FIXTURE_EXTRACT        AI_EXTRACT on the crop images
                        \             /
                       DT_DS_FIXTURES                           one row per fixture + text-layer check
                              |
                    view FIXTURE_SCHEDULE
```

- **Stream and task.** Only new drawings are processed.
- **Incremental dynamic tables.** AI_EXTRACT runs once per crop and is not re-run on later refreshes. `pipeline.sql` prints the refresh mode of each so you can confirm `INCREMENTAL` before resuming the task.
- **Crop step** ([`crop_schedules.py`](crop_schedules.py)). It finds every heading that ends in SCHEDULE in the PDF text layer. If the heading sits in a ruled table, the crop is that table, cut at any NOTES heading inside it. If not, it grows a box down from the heading until the first large vertical gap, the same method as `locate_from_text` in the large-sheet example. The title block is the right-edge strip. It uses pdfplumber and pypdfium2 because both are in the Snowflake Anaconda channel and PyMuPDF is not.
- **Text-layer check.** `CATALOG_IN_TEXT_LAYER` is TRUE for an exact match, FALSE for a likely misread, and NULL when the drawing has no text layer.
- **Failures are contained.** A drawing that fails to crop is marked `ERROR` in `DS_DRAWING_LOG` and the rest of the batch continues.

AI_EXTRACT reads the crop image, not the text layer, so the same extraction works on a scan once a scan can be cropped (see Limits).

## Run it

```sql
-- 1. Create the schema and code stage, then upload the crop module
CREATE SCHEMA IF NOT EXISTS SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE;
CREATE STAGE IF NOT EXISTS SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE.CODE ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE');
PUT file://examples/drawing-schedule-pipeline/crop_schedules.py @SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE.CODE AUTO_COMPRESS = FALSE OVERWRITE = TRUE;
```

2. Run [`pipeline.sql`](pipeline.sql). It uses warehouse `FULLSTACK_WH`; change it to yours. Check that the three `DT_DS_*` rows at the end show `INCREMENTAL`.
3. Resume the task and upload a drawing. The synthetic sheet is a good first test:

```bash
uv run examples/large-sheet-schedules/generate_sheets.py
```

```sql
ALTER TASK SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE.DS_DRAWING_TASK RESUME;
PUT file://examples/large-sheet-schedules/out/sheet_24x36.pdf @SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE.DRAWINGS AUTO_COMPRESS = FALSE;
-- about 7 minutes later
SELECT * FROM SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE.FIXTURE_SCHEDULE ORDER BY DRAWING_PATH, ROW_NUM;
ALTER TASK SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE.DS_DRAWING_TASK SUSPEND;
```

- The role needs CREATE SCHEMA on the database and the `SNOWFLAKE.CORTEX_USER` database role.
- AI_EXTRACT is billed in AI credits: two calls per drawing (title block and fixture schedule). Check current rates at https://docs.snowflake.com/en/user-guide/snowflake-cortex/aisql-cost before running at scale.
- Teardown: `DROP SCHEMA SNOWFLAKE_EXAMPLE.DRAWING_SCHEDULE_PIPELINE;`

Test the crop step locally: `uv run --with pdfplumber --with pypdfium2 --with pillow examples/drawing-schedule-pipeline/crop_schedules.py <drawing.pdf> out/`

Offline tests (no Snowflake): `uv run --with pymupdf --with pdfplumber --with pypdfium2 pytest tests/test_drawing_schedule_pipeline.py`

## Limits

- **Scans.** Location uses the PDF text layer, so a scanned sheet gets only its title block cropped. The large-sheet example's tile-and-OCR route finds the schedule on a scan; it is not wired into this pipeline yet.
- **Layouts.** Tested on two sheets, one synthetic and one real. Check the crops in `@CROPS` on a batch of your own drawings before relying on it.
- **One extractor.** Only the light fixture schedule is extracted. Other schedules are cropped and logged; adding one is another dynamic table.
- **Auto-refresh.** Directory auto-refresh on internal stages is available on AWS accounts. Elsewhere, run `ALTER STAGE DRAWINGS REFRESH` after uploading. https://docs.snowflake.com/en/user-guide/data-load-dirtables-auto

## Docs

- AI_EXTRACT: https://docs.snowflake.com/en/sql-reference/functions/ai_extract
- Dynamic tables: https://docs.snowflake.com/en/user-guide/dynamic-tables/overview
- Streams on directory tables: https://docs.snowflake.com/en/user-guide/data-load-dirtables-pipeline
