// Value chat: one short answer per Parse Mode, each grounded only on that mode's latest parse of one Document.
import { extractCitations } from "@/lib/agent-stream"

export const ASK_MODES = ["AGENTIC", "LAYOUT", "OCR"] as const
export type AskMode = (typeof ASK_MODES)[number]
export const MAX_QUESTION = 500
export const MAX_CONTEXT = 60_000
export const ASK_MODEL = "claude-sonnet-5-5"
export const NOT_FOUND = "Not in this parse"

export interface ModeAnswer { mode: AskMode; found: boolean; answer: string; pages: number[]; ms: number; noParse?: boolean; error?: boolean }
export interface AskResult { doc: string; question: string; answers: ModeAnswer[]; totalMs: number }

export interface PageRow { PAGE_INDEX: unknown; CONTENT: unknown }
export interface VisualRow { PAGE_INDEX: unknown; VISUAL_ID: unknown; IMAGE_TYPE: unknown; SUMMARY: unknown; VISIBLE_TEXT: unknown; DETAILS: unknown }

/** The question, trimmed, or null when empty, not a string, or over MAX_QUESTION. */
export function cleanQuestion(q: unknown): string | null {
  if (typeof q !== "string") return null
  const t = q.trim()
  return t && t.length <= MAX_QUESTION ? t : null
}

const s = (v: unknown) => (v == null ? "" : String(v))

/** Parsed text as the model sees it: 1-based page markers, then (AGENTIC only) the Visuals it understood. */
export function buildContext(pages: PageRow[], visuals: VisualRow[] = []): string {
  let ctx = pages.map((p) => `[Page ${Number(p.PAGE_INDEX) + 1}]\n${s(p.CONTENT)}`).join("\n\n")
  if (visuals.length)
    ctx += "\n\n=== VISUALS understood by the agentic parser ===\n" + visuals
      .map((v) => `[Page ${Number(v.PAGE_INDEX) + 1}] ${s(v.IMAGE_TYPE) || "visual"} ${s(v.VISUAL_ID)}: ${s(v.SUMMARY)} ${s(v.VISIBLE_TEXT)} ${typeof v.DETAILS === "string" ? v.DETAILS : v.DETAILS ? JSON.stringify(v.DETAILS) : ""}`.trim())
      .join("\n")
  return ctx.slice(0, MAX_CONTEXT)
}

export function buildPrompt(question: string, mode: AskMode, context: string): string {
  return `You answer a question about a document using ONLY the parsed text below. Do not use outside knowledge and do not guess. Quote values the text states. Do not deduce a value, for example by matching unlabeled numbers to labels or reasoning from a summary; finding the passage the question refers to is fine even when the text does not name it the same way. If the answer is not in the text, set found to false and answer "${NOT_FOUND}".
Keep the answer to one sentence at most. Include units and labels (for example "$13.8M (USD millions)", "Unchecked", "Power feed to Rack R1").
Reply with JSON only: {"found": true|false, "answer": "<short answer>", "pages": [<1-based page numbers the answer comes from>]}

QUESTION: ${question}

PARSED TEXT (${mode} mode):
${context}`
}

const NOT_FOUND_RE = /^\s*not (found )?in (this|the) parse/i

/** Model reply to {found, answer, pages}. Pages are 1-based, de-duplicated, within 1..pageCount. Bad JSON falls back to the raw text. */
export function parseAnswer(raw: string, pageCount: number): { found: boolean; answer: string; pages: number[] } {
  let found = true
  let answer = raw.trim()
  let pages: unknown[] = []
  const m = raw.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      const j = JSON.parse(m[0])
      if (typeof j.answer === "string") answer = j.answer.trim()
      if (j.found === false) found = false
      if (Array.isArray(j.pages)) pages = j.pages
    } catch { /* keep raw text */ }
  }
  if (!pages.length) pages = [...answer.matchAll(/\bp(?:age|\.)\s*(\d+)/gi)].map((x) => Number(x[1]))
  if (!answer || NOT_FOUND_RE.test(answer)) found = false
  const valid = [...new Set(pages.map(Number).filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount))].sort((a, b) => a - b)
  return found ? { found, answer, pages: valid } : { found, answer: NOT_FOUND, pages: [] }
}

const COMMAND_RE = /^\s*(show|open|go|close|zoom|next|previous|prev|back|compare|switch|select|re-?parse|run|yes|no|ok|okay|cancel|stop|take|bring|turn|highlight|scroll|clear|hide)\b/i
// About the app itself (where am I, tours, what a number on screen means): no Document answer to compare.
const APP_META_RE = /\b(where am i|what am i (looking at|seeing)|tour|this (screen|page|app)|home ?page|dark mode|light mode|theme|what was missed|explain (this|that|the|these)|(that|this|the) (number|score|strip|label|badge|button|toggle|table|box)|upload)\b/i

const CHAT_META_RE = /\b(what (did|have) (i|we) (just )?(ask|asked|say|said|discuss|discussed|talk)|my (last|previous|first) question|what was my question)\b/i

/** Viewer commands and confirmations ("next page", "zoom in", "yes, go ahead") get no mode comparison. */
export function isViewerCommand(question: string): boolean {
  if (CHAT_META_RE.test(question)) return true // about the chat itself: no Document answer to compare
  if (APP_META_RE.test(question)) return true
  return COMMAND_RE.test(question) && !question.includes("?")
}

/** A known Document id the question names, as written ("claim_packet") or with spaces ("the stamped invoice"). */
export function namedDoc(question: string, known?: Set<string>): string | null {
  if (!known) return null
  const q = question.toLowerCase()
  let best: string | null = null
  for (const id of known) {
    const re = new RegExp(`(^|[^a-z0-9])${id.split("_").map((w) => w.replace(/[^a-z0-9]/g, "")).join("[\\s_-]+")}($|[^a-z0-9])`)
    if (re.test(q) && (!best || id.length > best.length)) best = id
  }
  return best
}

export type AskSource = "named" | "viewer"

/** Which Document the comparison grounds on, before the agent answers: one the question names, else the one open in the viewer. */
export function pickAskDocNow(question: string, viewerDoc: string | null | undefined, known?: Set<string>): { doc: string; source: AskSource } | null {
  const named = namedDoc(question, known)
  if (named) return { doc: named, source: "named" }
  return viewerDoc ? { doc: viewerDoc, source: "viewer" } : null
}

/** Documents the agent cited, in order, de-duplicated; then any it opened in the viewer (it sometimes cites without parentheses). */
export function citedDocs(agentText: string, known?: Set<string>, actions: { doc?: string }[] = []): string[] {
  const cited = extractCitations(agentText, known).flatMap((c) => (c.kind === "doc" ? [c.doc] : []))
  const opened = actions.flatMap((a) => (a.doc && (!known || known.has(a.doc)) ? [a.doc] : []))
  return [...new Set([...cited, ...opened])]
}

/** Once the agent has answered: keep the comparison, ground it again on the Document the agent cited, or hide it.
 *  Hidden when the agent never searched parsed Documents (cost, scores, design and docs questions have no per-mode answer). */
export function compareAfterAgent(
  started: { doc: string; source: AskSource } | null,
  tools: string[],
  cited: string[],
): { kind: "keep" } | { kind: "hide" } | { kind: "run"; doc: string } | { kind: "nodoc" } {
  if (!tools.includes("parsed_documents")) return { kind: "hide" }
  if (!started) return cited.length ? { kind: "run", doc: cited[0] } : { kind: "nodoc" }
  if (started.source === "viewer" && cited.length && !cited.includes(started.doc)) return { kind: "run", doc: cited[0] }
  return { kind: "keep" }
}

/** Sample questions where the modes differ; each names its Document so it works from any page. */
export const ASK_SAMPLES: { doc: string; q: string }[] = [
  { doc: "quarterly_report", q: "In quarterly_report, what was Q3 revenue on the revenue chart?" },
  { doc: "floor_plan_diagram", q: "In floor_plan_diagram, what does Panel P1 connect to, and by what kind of link?" },
  { doc: "quarterly_report", q: "In quarterly_report, how many active customers were there in March?" },
  { doc: "floor_plan_diagram", q: "In floor_plan_diagram, which room is AHU-1 in, and what does its duct serve?" },
  // Fairness example: every mode reads this checkbox.
  { doc: "inspection_form", q: "In inspection_form, is the 'Guard in place' checkbox checked?" },
]

const PREF_KEY = "agentic-parse-demo:compare-modes"
export function loadComparePref(store: Pick<Storage, "getItem"> | undefined = typeof sessionStorage === "undefined" ? undefined : sessionStorage): boolean {
  return store?.getItem(PREF_KEY) !== "off"
}
export function saveComparePref(on: boolean, store: Pick<Storage, "setItem"> | undefined = typeof sessionStorage === "undefined" ? undefined : sessionStorage) {
  store?.setItem(PREF_KEY, on ? "on" : "off")
}

/** An all-miss table is noise when the agent's answer cites no Document page (scores, cost, chat-history questions).
 *  It stays when the agent did cite a page: then "no mode states it" is the honest finding. */
export function showCompareResult(result: AskResult, agentText: string, agentDone: boolean, known?: Set<string>): boolean {
  if (result.answers.some((a) => a.found)) return true
  if (!agentDone) return false
  return extractCitations(agentText, known).some((c) => c.kind === "doc")
}
