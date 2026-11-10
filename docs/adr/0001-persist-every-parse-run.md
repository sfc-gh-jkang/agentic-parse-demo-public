# Persist every Parse Run and serve reads from storage

AGENTIC mode is in Public Preview (released 2026-10-28) with best-effort output schemas, no published per-page rate, and a return type that already differs from its own doc examples (OBJECT, not string). We store every Parse Run's raw result in a table and have the app, search services and Demo Agent read from that table, re-parsing only on explicit request (upload, Run button, or the agent's re-parse tool). This keeps a live demo working if the preview function changes or errors, keeps cost bounded, and lets the UI label Live vs Cached Results honestly.

## Considered Options

- Call AI_PARSE_DOCUMENT on every page view: always fresh, but slow, costly, and a single preview regression breaks the demo mid-meeting.
- Dynamic Table over the stage: elegant, but refresh semantics hide when a parse actually ran, which the Live/Cached badge needs.
