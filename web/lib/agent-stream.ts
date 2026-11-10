import { parseAppAction, toolResult, type AppAction, type ViewerAction } from "@/lib/app-actions"

export interface SseEvent { event: string | null; data: unknown }

/** Splits an SSE buffer into complete events; the trailing partial frame is returned as `rest`. Non-JSON data (end marker) is kept as a string. */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const frames = buffer.replace(/\r\n/g, "\n").split("\n\n")
  const rest = frames.pop() ?? ""
  const events: SseEvent[] = []
  for (const frame of frames) {
    let event: string | null = null
    const data: string[] = []
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""))
    }
    if (!data.length && !event) continue
    const raw = data.join("\n")
    let parsed: unknown = raw
    try {
      parsed = JSON.parse(raw)
    } catch { /* end-of-stream marker or plain text */ }
    events.push({ event, data: parsed })
  }
  return { events, rest }
}

export type Citation =
  | { kind: "doc"; doc: string; page: number; visual?: string }
  | { kind: "design"; path: string }

const DOC_CITE = /\(([a-z0-9_]{1,64}),\s*page\s+(\d+)(?:,\s*([\w.\-]+))?\)/g
// "Source: receipt_photo, page 1" without parentheses; only trusted for known Document ids.
const BARE_CITE = /(?<![\w(])([a-z0-9_]{1,64}),\s*page\s+(\d+)\b/g
// One parenthesis may list several design docs: (docs/app-guide.md, docs/stage2-report.md).
const DESIGN_CITE = /\(\s*([\w./-]+\.md(?:\s*,\s*[\w./-]+\.md)*)\s*\)/g

/** Citations the Demo Agent writes in its answer, e.g. (stamped_invoice, page 1) or (GLOSSARY.md).
 *  The agent writes 1-based pages for people; the returned Citation page is 0-based like the viewer. */
export function extractCitations(text: string, knownDocs?: Set<string>): Citation[] {
  const out: Citation[] = []
  const seen = new Set<string>()
  const add = (c: Citation, key: string) => {
    if (!seen.has(key)) {
      seen.add(key)
      out.push(c)
    }
  }
  for (const m of text.matchAll(DOC_CITE)) {
    if (knownDocs && !knownDocs.has(m[1])) continue
    if (Number(m[2]) < 1) continue
    add({ kind: "doc", doc: m[1], page: Number(m[2]) - 1, ...(m[3] ? { visual: m[3] } : {}) }, `d:${m[1]}:${m[2]}:${m[3] ?? ""}`)
  }
  if (knownDocs) {
    for (const m of text.matchAll(BARE_CITE)) {
      if (!knownDocs.has(m[1]) || Number(m[2]) < 1) continue
      add({ kind: "doc", doc: m[1], page: Number(m[2]) - 1 }, `d:${m[1]}:${m[2]}:`)
    }
  }
  for (const m of text.matchAll(DESIGN_CITE)) {
    for (const path of m[1].split(",").map((x) => x.trim())) add({ kind: "design", path }, `p:${designName(path)}`)
  }
  return out
}

/** File name of a design-doc path ("docs/app-guide.md" -> "app-guide.md"); the chip label and dedupe key. */
export function designName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

/** Text on a citation chip. */
export function citationLabel(c: Citation): string {
  return c.kind === "doc" ? `${c.doc} · page ${c.page + 1}${c.visual ? ` · ${c.visual}` : ""}` : designName(c.path)
}

/** The citation as a viewer action: a Visual selects it, a page navigates. Design docs have none. */
export function citationAction(c: Citation): ViewerAction | null {
  if (c.kind !== "doc") return null
  return c.visual ? { doc: c.doc, page: c.page, visual: c.visual } : { doc: c.doc, page: c.page }
}

/** One line of the "How I answered" panel, in arrival order. */
export type Step =
  | { kind: "status"; text: string }
  | { kind: "thinking"; text: string; index: number | null }
  | { kind: "tool"; id: string; name: string; state: "running" | "done" | "failed"; detail: string }

export interface AgentTurn {
  /** Planning, reasoning and tool calls in the order the agent did them. */
  steps: Step[]
  text: string
  status: string | null
  tools: string[]
  actions: AppAction[]
  reparse: boolean
  /** Set by a successful reparse tool result: the app marks the run Live and shows it. */
  reparsed: { doc: string; mode: string; runId: string } | null
  error: string | null
  done: boolean
  /** The final text block has arrived; the stream is only closing (suggested queries, aggregate). */
  answered: boolean
  /** Set by the 'Forming the answer' status so the next text block counts as the final one. */
  finalizing: boolean
  lastTextIndex: number | null
  /** Most recent tool the agent started, for the waiting status line. */
  lastTool: string | null
}

export const emptyTurn = (): AgentTurn => ({
  text: "", steps: [], status: null, tools: [], actions: [], reparse: false, reparsed: null, error: null, done: false, answered: false, finalizing: false, lastTextIndex: null, lastTool: null,
})

const DETAIL_KEYS = ["query", "sql", "question", "action", "doc"]

/** Short, human-readable summary of a tool call's input (never the whole payload). */
function toolDetail(input: unknown): string {
  const o = obj(input)
  for (const k of DETAIL_KEYS) if (typeof o[k] === "string" && o[k]) return String(o[k]).slice(0, 140)
  return ""
}

function finishTool(turn: AgentTurn, d: Record<string, any>): AgentTurn {
  const id = typeof d.tool_use_id === "string" ? d.tool_use_id : null
  const failed = d.status === "error" || d.status === "failed"
  let at = id ? turn.steps.findIndex((s) => s.kind === "tool" && s.id === id) : -1
  if (at < 0) at = turn.steps.findIndex((s) => s.kind === "tool" && s.name === d.name && s.state === "running")
  if (at < 0) return turn
  const steps = [...turn.steps]
  steps[at] = { ...(steps[at] as Extract<Step, { kind: "tool" }>), state: failed ? "failed" : "done" }
  return { ...turn, steps }
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" ? (v as Record<string, any>) : {})

/** Folds one stream event into the turn. Unknown events are ignored. */
export function reduceAgentEvent(turn: AgentTurn, ev: SseEvent): AgentTurn {
  const d = obj(ev.data)
  switch (ev.event) {
    case "response.text.delta": {
      const idx = typeof d.content_index === "number" ? d.content_index : null
      const sep = turn.text && idx !== null && turn.lastTextIndex !== null && idx !== turn.lastTextIndex ? "\n\n" : ""
      return { ...turn, text: turn.text + sep + String(d.text ?? ""), lastTextIndex: idx ?? turn.lastTextIndex }
    }
    case "response.text": {
      const base = turn.text ? turn : { ...turn, text: String(d.text ?? "") }
      return turn.finalizing ? { ...base, answered: true } : base
    }
    case "response.status": {
      const msg = typeof d.message === "string" ? d.message : null
      const last = turn.steps[turn.steps.length - 1]
      const steps = msg && !(last?.kind === "status" && last.text === msg) ? [...turn.steps, { kind: "status" as const, text: msg }] : turn.steps
      return { ...turn, steps, status: msg ?? turn.status, finalizing: turn.finalizing || d.status === "proceeding_to_answer" }
    }
    case "response.thinking.delta":
    case "response.thinking": {
      const text = typeof d.text === "string" ? d.text : ""
      const idx = typeof d.content_index === "number" ? d.content_index : null
      if (!text) return turn
      const at = turn.steps.findLastIndex((s) => s.kind === "thinking" && s.index === idx)
      const steps = [...turn.steps]
      if (at >= 0 && steps[at].kind === "thinking") {
        const cur = steps[at] as Extract<Step, { kind: "thinking" }>
        steps[at] = { ...cur, text: ev.event === "response.thinking" ? text : cur.text + text }
      } else steps.push({ kind: "thinking", text, index: idx })
      return { ...turn, steps }
    }
    case "response.tool_use": {
      const name = typeof d.name === "string" ? d.name : null
      if (!name) return turn
      const step: Step = { kind: "tool", id: typeof d.tool_use_id === "string" ? d.tool_use_id : `${name}-${turn.steps.length}`, name, state: "running", detail: toolDetail(d.input) }
      return { ...turn, steps: [...turn.steps, step], tools: turn.tools.includes(name) ? turn.tools : [...turn.tools, name], reparse: turn.reparse || name === "reparse", lastTool: name }
    }
    case "response.tool_result": {
      turn = finishTool(turn, d)
      const a = parseAppAction(ev)
      if (a) return { ...turn, actions: [...turn.actions, a] }
      const r = toolResult(ev, "reparse")
      if (r?.ok && typeof r.run_id === "string" && typeof r.doc === "string" && typeof r.mode === "string")
        return { ...turn, reparsed: { doc: r.doc, mode: r.mode, runId: r.run_id } }
      return turn
    }
    case "error":
      return { ...turn, error: typeof d.message === "string" ? d.message : typeof ev.data === "string" ? ev.data : "The agent returned an error", done: true }
    case "response":
      return { ...turn, done: true }
    default:
      return turn
  }
}

const TOOL_STATUS: Record<string, string> = {
  parsed_documents: "Searching parsed pages…",
  design_docs: "Searching the design docs…",
  snowflake_docs: "Searching Snowflake documentation…",
  mode_scores: "Checking scores…",
  parse_analytics: "Checking scores…",
  system_execute_sql: "Checking scores…",
  measured_cost: "Checking measured cost…",
  control_app: "Moving the viewer…",
  reparse: "Re-parsing (billed)…",
}

/** The waiting line under a streaming answer: specific to what the agent is doing right now. */
export function statusLabel(turn: AgentTurn): string {
  if (turn.text) return "Writing the answer…"
  if (turn.lastTool) return TOOL_STATUS[turn.lastTool] ?? "Using a tool…"
  const s = (turn.status ?? "").toLowerCase()
  if (/plan/.test(s)) return "Planning…"
  if (/search|retriev/.test(s)) return "Searching parsed pages…"
  if (/analy|sql|query/.test(s)) return "Checking scores…"
  return "Thinking…"
}

const TOOL_PLAIN: Record<string, string> = {
  parse_analytics: "Looked up scores and counts across Documents and Modes",
  mode_scores: "Checked how each Mode scored on one Document",
  parsed_documents: "Searched the parsed pages",
  design_docs: "Searched the demo's design docs",
  snowflake_docs: "Searched Snowflake documentation",
  measured_cost: "Looked up measured cost",
  control_app: "Moved or highlighted something on screen",
  reparse: "Re-parsed a Document (billed)",
  system_execute_sql: "Ran a read-only query",
}

/** Plain-language lines for the "How I answered" panel (one per step, thinking text kept as written). */
export function explainSteps(steps: Step[]): string[] {
  return steps.map((s) => {
    if (s.kind === "status") return s.text
    if (s.kind === "thinking") return s.text.trim()
    const base = TOOL_PLAIN[s.name] ?? `Used the ${s.name} tool`
    const detail = s.name === "control_app" ? s.detail.replace(/_/g, " ") : s.detail
    const what = detail ? `${base}: ${detail}` : base
    return s.state === "failed" ? `${what}. That step did not work.` : what
  })
}
