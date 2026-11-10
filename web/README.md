# Agentic Parse Demo (web)

A Next.js app on Snowflake App Runtime that shows a synthetic Corpus of Documents parsed in all three AI_PARSE_DOCUMENT Parse Modes (OCR, LAYOUT, AGENTIC). Vocabulary follows `../GLOSSARY.md`.

Docs: https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document and https://docs.snowflake.com/en/sql-reference/functions/ai_parse_document (AGENTIC mode is in preview).

## What it does

- `/` lists Documents in the Corpus with type, pages, which Parse Modes have a stored Parse Run, and last parsed time, plus measured AI credits per 1k pages for each Parse Mode (or "pending" while usage telemetry lags).
- `/documents/[id]` is the viewer. Reads are Cached Results. The only things that spend AI credits are the Upload card and the Run buttons, which call `APP_PARSE`.

### Viewer

- **Two views** (segmented control): **One mode** (default) shows the Document at 65% width beside a Parse Mode picker (AGENTIC first) and that mode's page text. **Compare modes** shows the Document at 40% beside two columns with AGENTIC always on the left (amber outline); the picker has exactly **AGENTIC vs LAYOUT** (default) and **AGENTIC vs OCR**. The columns scroll in sync.
- **Divider**: drag to resize (25-80%), remembered per view in `localStorage`, double-click resets to that view's default.
- **Document toolbar** (PDFs and image files use the same component): Fit width (default), Fit page, -/+ 50-300%, double-click zooms 2x at the point (double-click again to return), drag to pan (only after a 3 px drag, so double-click still works), magnifier lens (key `M`). PDFs re-render crisply once zoom settles.
- **Visual boxes**: every AGENTIC Visual on the selected page is drawn at its normalized bbox (`PARSE_VISUALS.X0..Y1`; image files have NULL boxes, so the box covers the whole image). Boxes show in both views. Hover shows the `image_type`; click selects. Failed Visuals have a red dashed box.
- **Visual detail** is an inline card above the parse text on the right (not a sheet, so the Document stays visible). Left: the AGENTIC result (type, summary, chart series table, diagram components and connections, key values, visible text), or "AGENTIC could not read this Visual" for a failed Visual. Right: the matched Ground Truth Visual with "✓ n/n fields match" or the missed values. Uploaded Documents show "No Ground Truth for uploaded Documents".
- **Score strip** (viewer header): Relations found, Facts inside images and Visuals detected (AGENTIC only, `n/a` for the text modes) for the shown modes (all three in One mode). "What was missed" lists the missed facts and Visuals per mode. Relations = a value paired with its label, edge or row.

### Upload and Run

- **Upload a Document** card on `/`: drag-and-drop or file picker, Parse Mode checkboxes (all checked by default). Uploading starts immediately, then each checked mode parses in parallel with Queued / Parsing… / Done / Failed rows, then the viewer opens.
- **Limits** (enforced in `UPLOAD_DOCUMENT`, pre-checked by the route): PDF, PPTX, DOCX, PNG, JPG, TIFF; 10 MB; 20 pages (PDF via pypdf, PPTX slides via python-pptx, images 1; DOCX is capped by size only because it has no reliable page count); extension and magic bytes must agree; the filename never reaches a path (stored as `up_<slug>_<6 hex>`).
- **Run** button per Parse Mode in the viewer calls `POST /api/documents/[id]/parse`. Runs started in this browser session (ids kept in `sessionStorage`) show **Live Result**; everything else shows **Cached Result · <age>**.
- Uploaded Documents have no Ground Truth, so there are no scores; they are listed with an **Uploaded** badge. App-triggered runs have `PARSE_RUNS.TRIGGER_SOURCE = 'app'` (`TRIGGER` is a reserved word).

## Snowflake objects used

All in `SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO`, read with owner's rights (role `AGENTIC_PARSE_DEMO_RL`, warehouse `SFE_AGENTIC_PARSE_DEMO_WH`). Created by `../sql/`.

| Object | Used by | Purpose |
|---|---|---|
| `DOCUMENT_CATALOG` view | `GET /api/documents` | one row per Document |
| `DOCUMENT_FILES` table | `GET /api/documents/[id]/file` | Document bytes (BINARY) read in ~0.1 s; the route adds an in-process LRU cache (50 MB) and ETag/304 on the sha256 (the container has no egress to cloud storage) |
| `PARSE_PAGES` + `LATEST_RUNS` views | `GET /api/documents/[id]/runs` | latest Parse Run per Parse Mode with per-page text |
| `PARSE_VISUALS` view + `LATEST_RUNS` | `GET /api/documents/[id]/visuals` | Visuals of the latest AGENTIC run: type, summary, details, FAILED, normalized bbox |
| `MODE_COMPARISONS` table | `GET /api/documents/[id]/comparison` | stored scores per Parse Mode: fact and Relation counts, `MATCHES` (per-Visual Ground Truth result), `MISSED`. Filled by `REFRESH_MODE_COMPARISONS`; no rows for Documents without Ground Truth |
| `PARSE_COST(NULL)` procedure | `GET /api/cost` | measured credits per Parse Mode |
| `UPLOAD_DOCUMENT(name, base64)` procedure | `POST /api/upload` | validates, writes `@DOCS/uploads/`, registers `DOCUMENTS` + `DOCUMENT_FILES` |
| `APP_PARSE(doc_id, mode)` procedure | `POST /api/documents/[id]/parse` | `PARSE_DOCUMENT`, tags the run `app`, refreshes the Mode Comparison when Ground Truth exists |

Routes return wrapper objects: `{ runs }`, `{ visuals }`, `{ comparisons }`; an empty result is an empty array inside the wrapper.

## Run locally

```bash
npm install
SNOWFLAKE_CONNECTION_NAME=<your-connection> npm run dev
```

Local dev needs the demo role, not the connection's default. `.env.local` (git-ignored) sets it:

```
SNOWFLAKE_ROLE=AGENTIC_PARSE_DEMO_RL
SNOWFLAKE_WAREHOUSE=SFE_AGENTIC_PARSE_DEMO_WH
```

Production-mode preview: `npm run build && SNOWFLAKE_CONNECTION_NAME=<your-connection> npm run start`. Never preview with `node .next/standalone/server.js` (it does not serve `.next/static`). `next start` warns about `output: standalone`; the warning is harmless.

Checks after starting:

```bash
curl -fsS http://localhost:3000/ | head -c 200
curl -fsS http://localhost:3000/api/documents
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:3000/_next/static/chunks/<any-chunk>.js
```


### Pitfall: never run `npm run build` while `npm run dev` is running

Both write `.next/`. The production build overwrites the dev server's state, after which the dev server sends an HMR `restart` to every browser connection and the page reloads itself in a loop (measured: 163 reloads in 20 s). Fix: stop the dev server, `rm -rf .next`, start `npm run dev` again. Verify a production build only with the dev server stopped.

## Test

```bash
npm test            # vitest, mocks @/lib/snowflake
npx tsc --noEmit
```

Tests cover route behaviour (response shape, timestamp normalization, bytes and content type, 404 on NULL, 400 on invalid id with no query issued, grouping by Parse Mode, pending cost passthrough, Visuals and Mode Comparison shapes) and the pure viewer logic in `lib/viewer-utils.ts` (bbox to percent, AGENTIC-left pair selection, divider clamp, Ground Truth match lookup). Write the test before the route.

## Deploy

```bash
snow app deploy
```

`app.yml` is a `version: 2` manifest holding both deployment config and build phases. A v2 deploy is declarative, so `ALTER APPLICATION SERVICE ... SET` changes are reverted unless also in `app.yml`. The app is restricted to the demo role by granting the service to `AGENTIC_PARSE_DEMO_RL` only.

## Design notes and pitfalls

- **Use `querySnowflake` from `@/lib/snowflake` with bind params.** Never interpolate input into SQL. Document ids are also validated against `/^[a-z0-9_]{1,64}$/` before any query. Do not edit `lib/snowflake.ts`, `lib/sar-sdk/`, or `next.config.mjs`.
- **Timestamps arrive as `Date` objects.** Normalize with `toIso` (`lib/api-utils.ts`) at the API boundary. ARRAY columns (`MODES_PARSED`) arrive as JSON strings; `toStringArray` handles both.
- **`CALL` results are a normal result set.** `PARSE_COST` returns one row per Parse Mode.
- **pdf.js worker is bundled, not fetched.** `components/documents/zoom-page.tsx` sets `workerSrc` with `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`; Next emits it under `/_next/static/media/`, served from our own origin. No CDN URLs anywhere: the deployed container has restricted egress. pdf.js is imported dynamically in an effect because it touches DOM globals at import time.
- **Tailwind Preflight strips markdown styling.** Rendered LAYOUT and AGENTIC markdown is wrapped in `.parsed-markdown`, whose styles live in `app/globals.css`. OCR is shown as preformatted text. Raw HTML inside markdown is not rendered (no `rehype-raw`).
- **Parse output shape** (see `../docs/parse-output-notes.md`): paged files give one row per page; image files give a single page with no dimensions.
- **Only `APP_PARSE` and `UPLOAD_DOCUMENT` may be called from the app**, and only from the parse and upload routes. Never call `PARSE_DOCUMENT`, `COMPARE_MODES` or `REFRESH_MODE_COMPARISONS` directly.
- **Visual ids repeat across pages** (`img-0.jpeg`), so selection and Ground Truth matching key on page plus id (`visualKey`, `matchForVisual`).
- **VARIANT columns** (`DETAILS`, `MATCHES`, `MISSED`) are normalized with `toJsonValue`, which accepts parsed objects or JSON strings.
