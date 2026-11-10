import { describe, expect, it } from "vitest"
import { citationAction, citationLabel, emptyTurn, explainSteps, extractCitations, parseSseChunk, reduceAgentEvent } from "../../lib/agent-stream"

describe("parseSseChunk", () => {
  it("parses complete frames and returns the partial tail", () => {
    const { events, rest } = parseSseChunk('event: response.status\ndata: {"message":"Planning"}\n\nevent: response.text.delta\ndata: {"te')
    expect(events).toEqual([{ event: "response.status", data: { message: "Planning" } }])
    expect(rest).toBe('event: response.text.delta\ndata: {"te')
  })
  it("completes a frame split across chunks", () => {
    const a = parseSseChunk('event: response.text.delta\ndata: {"text":"Hel')
    const b = parseSseChunk(a.rest + 'lo"}\n\n')
    expect(b.events[0].data).toEqual({ text: "Hello" })
  })
  it("tolerates CRLF, the non-JSON end marker and empty frames", () => {
    const { events } = parseSseChunk('event: a\r\ndata: {"x":1}\r\n\r\n\n\ndata: [DONE]\n\n')
    expect(events).toEqual([{ event: "a", data: { x: 1 } }, { event: null, data: "[DONE]" }])
  })
})

describe("reduceAgentEvent", () => {
  it("accumulates deltas, status and distinct tool names; separates text blocks", () => {
    let t = emptyTurn()
    for (const ev of [
      { event: "response.status", data: { message: "Searching" } },
      { event: "response.tool_use", data: { name: "parsed_documents" } },
      { event: "response.tool_use", data: { name: "parsed_documents" } },
      { event: "response.text.delta", data: { text: "Hi", content_index: 0 } },
      { event: "response.text.delta", data: { text: " there", content_index: 0 } },
      { event: "response.text.delta", data: { text: "Done", content_index: 2 } },
    ]) t = reduceAgentEvent(t, ev)
    expect(t).toMatchObject({ status: "Searching", tools: ["parsed_documents"], text: "Hi there\n\nDone", reparse: false })
  })
  it("collects control_app actions and flags reparse", () => {
    let t = reduceAgentEvent(emptyTurn(), { event: "response.tool_use", data: { name: "reparse", input: {} } })
    expect(t.reparse).toBe(true)
    t = reduceAgentEvent(t, { event: "response.tool_result", data: { name: "control_app", status: "success", content: [{ json: { result: '{"action":"zoom","zoom":"fit_page"}' } }] } })
    expect(t.actions).toEqual([{ action: "zoom", zoom: "fit_page" }])
  })
  it("uses response.text only when no deltas arrived, surfaces error events, finishes on response", () => {
    expect(reduceAgentEvent(emptyTurn(), { event: "response.text", data: { text: "whole" } }).text).toBe("whole")
    expect(reduceAgentEvent({ ...emptyTurn(), text: "x" }, { event: "response.text", data: { text: "whole" } }).text).toBe("x")
    expect(reduceAgentEvent(emptyTurn(), { event: "error", data: { message: "boom" } })).toMatchObject({ error: "boom", done: true })
    expect(reduceAgentEvent(emptyTurn(), { event: "response", data: {} }).done).toBe(true)
    expect(reduceAgentEvent(emptyTurn(), { event: "mystery", data: {} })).toEqual(emptyTurn())
  })
})

describe("citations", () => {
  const known = new Set(["stamped_invoice", "claim_packet"])
  it("maps 1-based doc/page and doc/page/visual citations to 0-based pages, deduplicated", () => {
    const text = "Total is 42 (stamped_invoice, page 1). Stamp (claim_packet, page 2, img-0.jpeg). Again (stamped_invoice, page 1). Bad (stamped_invoice, page 0)."
    expect(extractCitations(text, known)).toEqual([
      { kind: "doc", doc: "stamped_invoice", page: 0 },
      { kind: "doc", doc: "claim_packet", page: 1, visual: "img-0.jpeg" },
    ])
  })
  it("drops unknown docs when a corpus is given and keeps design doc paths", () => {
    expect(extractCitations("(ghost, page 0) (GLOSSARY.md) (docs/SPEC.md)", known)).toEqual([
      { kind: "design", path: "GLOSSARY.md" }, { kind: "design", path: "docs/SPEC.md" },
    ])
  })
  it("D4: accepts 'Source: doc, page N' without parentheses, only for known docs", () => {
    expect(extractCitations("Source: claim_packet, page 2. Also ghost, page 1 and (stamped_invoice, page 1).", known)).toEqual([
      { kind: "doc", doc: "stamped_invoice", page: 0 },
      { kind: "doc", doc: "claim_packet", page: 1 },
    ])
    expect(extractCitations("Source: claim_packet, page 2")).toEqual([])
  })
  it("turns a citation into a viewer action; design docs have none", () => {
    expect(citationAction({ kind: "doc", doc: "a", page: 2 })).toEqual({ doc: "a", page: 2 })
    expect(citationAction({ kind: "doc", doc: "a", page: 2, visual: "v" })).toEqual({ doc: "a", page: 2, visual: "v" })
    expect(citationAction({ kind: "design", path: "GLOSSARY.md" })).toBeNull()
  })
})

describe("reparse result", () => {
  const res = (result: unknown, name = "reparse") => ({ event: "response.tool_result", data: { name, status: "success", content: [{ json: { result: JSON.stringify(result) } }] } })
  it("records the new Live run so the app can show it", () => {
    const t = reduceAgentEvent(emptyTurn(), res({ ok: true, run_id: "r1", doc: "receipt_photo", mode: "OCR", pages: 1 }))
    expect(t.reparsed).toEqual({ doc: "receipt_photo", mode: "OCR", runId: "r1" })
  })
  it("ignores failed or other tool results", () => {
    expect(reduceAgentEvent(emptyTurn(), res({ ok: false, error: "x", doc: "a", mode: "OCR" })).reparsed).toBeNull()
    expect(reduceAgentEvent(emptyTurn(), res({ ok: true, run_id: "r1", doc: "a", mode: "OCR" }, "mode_scores")).reparsed).toBeNull()
  })
})

describe("citationLabel", () => {
  it("labels design-doc chips with the file name and dedupes repeats", async () => {
    const { extractCitations, citationLabel } = await import("@/lib/agent-stream")
    const cites = extractCitations("See (docs/app-guide.md) and (app-guide.md) and (docs/stage2-report.md).")
    const labels = cites.filter((c) => c.kind === "design").map(citationLabel)
    expect(labels).toEqual(["app-guide.md", "stage2-report.md"])
  })
})

describe("extractCitations design docs (C2)", () => {
  it("splits comma-separated paths in one parenthesis, labels by basename, dedupes", () => {
    const cites = extractCitations("See (docs/app-guide.md, docs/stage2-report.md) and (app-guide.md).")
    expect(cites).toEqual([
      { kind: "design", path: "docs/app-guide.md" },
      { kind: "design", path: "docs/stage2-report.md" },
    ])
    expect(cites.map(citationLabel)).toEqual(["app-guide.md", "stage2-report.md"])
  })
})

describe("how-I-answered steps", () => {
  const fold = (evs: { event: string; data: unknown }[]) => evs.reduce(reduceAgentEvent, emptyTurn())
  it("records status, thinking, tool calls and results in arrival order", () => {
    const t = fold([
      { event: "response.status", data: { message: "Planning the next steps" } },
      { event: "response.thinking.delta", data: { content_index: 0, text: "I need scores " } },
      { event: "response.thinking.delta", data: { content_index: 0, text: "first." } },
      { event: "response.thinking", data: { content_index: 0, text: "I need scores first.", signature: "x" } },
      { event: "response.tool_use", data: { tool_use_id: "a", name: "parse_analytics", input: { query: "recall by mode" } } },
      { event: "response.tool_result", data: { tool_use_id: "a", name: "parse_analytics", status: "success", content: [] } },
      { event: "response.tool_use", data: { tool_use_id: "b", name: "parsed_documents", input: { query: "biggest miss" } } },
      { event: "response.tool_result", data: { tool_use_id: "b", name: "parsed_documents", status: "error", content: [] } },
    ])
    expect(t.steps.map((s) => s.kind)).toEqual(["status", "thinking", "tool", "tool"])
    expect(t.steps[1]).toMatchObject({ kind: "thinking", text: "I need scores first." })
    expect(t.steps[2]).toMatchObject({ kind: "tool", name: "parse_analytics", state: "done", detail: "recall by mode" })
    expect(t.steps[3]).toMatchObject({ kind: "tool", name: "parsed_documents", state: "failed" })
  })
  it("collapses repeated identical status lines and keeps streaming thinking in one step", () => {
    const t = fold([
      { event: "response.status", data: { message: "Planning" } },
      { event: "response.status", data: { message: "Planning" } },
      { event: "response.thinking.delta", data: { content_index: 1, text: "ab" } },
      { event: "response.thinking.delta", data: { content_index: 1, text: "cd" } },
    ])
    expect(t.steps).toHaveLength(2)
    expect(t.steps[1]).toMatchObject({ kind: "thinking", text: "abcd" })
  })
  it("keeps repeated calls to the same tool as separate steps (redundancy stays visible)", () => {
    const t = fold([
      { event: "response.tool_use", data: { tool_use_id: "a", name: "design_docs", input: {} } },
      { event: "response.tool_use", data: { tool_use_id: "b", name: "design_docs", input: {} } },
    ])
    expect(t.steps.filter((s) => s.kind === "tool")).toHaveLength(2)
    expect(t.tools).toEqual(["design_docs"])
  })
})

describe("explainSteps", () => {
  it("turns steps into plain-language lines", () => {
    const lines = explainSteps([
      { kind: "status", text: "Planning the next steps" },
      { kind: "tool", id: "a", name: "parse_analytics", state: "done", detail: "recall by mode" },
      { kind: "tool", id: "b", name: "control_app", state: "failed", detail: "" },
    ])
    expect(lines[0]).toMatch(/Planning/)
    expect(lines[1]).toMatch(/scores and counts/i)
    expect(lines[1]).toMatch(/recall by mode/)
    expect(lines[2]).toMatch(/did not work/i)
  })
})

describe("answered (final text received, stream still closing)", () => {
  const fold = (evs: { event: string; data: unknown }[]) => evs.reduce(reduceAgentEvent, emptyTurn())
  it("is set by the text block that follows 'Forming the answer', not by earlier text blocks", () => {
    const early = fold([
      { event: "response.text", data: { text: "Q3 was 13.8.", content_index: 1 } },
      { event: "response.tool_use", data: { tool_use_id: "a", name: "control_app", input: {} } },
    ])
    expect(early.answered).toBe(false)
    const final = fold([
      { event: "response.text", data: { text: "Q3 was 13.8.", content_index: 1 } },
      { event: "response.status", data: { message: "Forming the answer", status: "proceeding_to_answer" } },
      { event: "response.text", data: { text: "The chart is open.", content_index: 3 } },
    ])
    expect(final.answered).toBe(true)
    expect(final.done).toBe(false)
  })
  it("is not set by a status alone", () => {
    expect(fold([{ event: "response.status", data: { message: "Forming the answer", status: "proceeding_to_answer" } }]).answered).toBe(false)
  })
})
