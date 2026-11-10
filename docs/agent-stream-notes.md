# Agent stream notes (T10 spike)

> T18: `control_viewer` is now `control_app` (pages 1-based); the stream shape below is unchanged.

Question: does a custom procedure tool's result reach the client in the `agent:run` SSE stream, so the
web app can read the `control_viewer` action JSON? **Yes.** No fenced-block fallback is needed.

Measured 2026-10-30 on the demo account (the author's demo account), model `claude-sonnet-5-5`, with a throwaway agent
holding only `control_viewer` (generic tool, `type: procedure` resource) and the question
"Show me page 3 of claim_packet". Recorder: `scripts/agent_stream_spike.py <AGENT_FQN> "<question>"`
(REST `POST /api/v2/databases/{db}/schemas/{schema}/agents/{name}:run`, `stream: true`, session token auth).
Docs: https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-run

Event types seen, with counts:

| event | count |
|---|---|
| `response.status` | 8 |
| `response.tool_use` | 1 |
| `response.tool_result.status` | 2 |
| `response.tool_result` | 1 |
| `response.text.delta` | 3 |
| `response.text` | 1 |
| `response.suggested_queries` | 1 |
| `response` | 1 |

One further `data:` line was not JSON (end-of-stream marker); a client must tolerate it.

## Where the action is

`response.tool_result` (verbatim, ids trimmed):

```json
{"content": [{"json": {"execution_type": "procedure", "query_id": "01c81646-...",
  "result": "{\"action\":\"navigate\",\"doc\":\"claim_packet\",\"page\":2}", "truncated": false},
  "type": "json"}],
 "content_index": 1, "name": "control_viewer", "status": "success", "tool_use_id": "toolu_...", "type": "generic"}
```

- The procedure's return value is a **string** at `content[0].json.result`; parse it a second time.
- Filter on `name == "control_viewer"` and `status == "success"`; an `{"error": ...}` result means the
  procedure rejected the request and the app should ignore it.
- `response.tool_use` arrives first with the model's `input` (unvalidated). Apply the `tool_result`,
  never the `tool_use`.
- The final `response` event repeats both as `content[]` items of type `tool_use` and `tool_result`;
  `DATA_AGENT_RUN` (non-streaming SQL) returns the same `content[]`, which is what the tests read.
- `truncated: false` is reported; the action JSON is tiny, so truncation is not a concern for this tool.

## Page numbering

The viewer and `PARSE_VISUALS.PAGE_INDEX` are 0-based. Agent instructions map "page N" from a user to
`page: N-1`; the spike answered "Page 3 ... is now open" with `page: 2`.
