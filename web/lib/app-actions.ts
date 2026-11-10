import type { ViewKind } from "@/lib/viewer-utils"
import type { ParseMode } from "@/lib/doc-utils"

/** UI elements the Demo Agent can spotlight. Each has a data-tour="<name>" element in the app (a test scans for them).
 *  Keep in sync with TARGETS in CONTROL_APP (sql/09_agent_tools.sql) and docs/app-guide.md. */
export const TARGETS = [
  "document_list", "upload_card", "score_strip", "what_was_missed", "mode_tabs",
  "view_toggle", "compare_pair_tabs", "page_buttons", "zoom_controls", "document_page", "visual_box", "visual_detail",
  "parsed_text", "run_button", "cached_label", "chat_panel", "compare_answers_toggle", "compare_answers_table",
  "theme_toggle", "command_menu", "cost_stats", "presenter_questions", "eval_button", "value_panel", "volume_input",
  "use_data_tab", "doc_tabs",
] as const
export type Target = (typeof TARGETS)[number]

export const ACTIONS = [
  "go_home", "open_document", "set_page", "set_view", "set_mode", "set_pair", "select_visual", "close_visual",
  "zoom", "show_missed", "set_compare_answers", "open_upload", "set_theme", "scroll", "highlight", "clear_highlight", "tour", "start_tour",
  "open_value_panel", "set_volume", "set_review_assumptions", "open_use_data_tab",
] as const
export type AppActionName = (typeof ACTIONS)[number]

export type ViewerZoom = "fit_width" | "fit_page" | number
export type ViewerPair = "LAYOUT" | "OCR"
export type ScrollTo = "top" | "bottom" | "parsed_text" | "document"

/** One spotlight stop. Page is 1-based, as the agent and people count. */
export interface TourStep {
  target: Target
  caption: string
  route?: "home" | "document"
  doc?: string
  page?: number
  /** Only the built-in onboarding tour (lib/onboarding.ts) sets these; steps from the agent never carry them. */
  view?: ViewKind
  mode?: ParseMode
  ui?: "chat_open" | "open_first_visual" | "open_data_tab"
}

/** What the control_app tool echoes. Pages are 1-based. Optional fields combine with any action. */
export interface AppAction {
  action: AppActionName
  doc?: string
  page?: number
  view?: ViewKind
  mode?: ParseMode
  pair?: ViewerPair
  visual?: string
  zoom?: ViewerZoom
  missed?: "open" | "close"
  compareAnswers?: boolean
  theme?: "light" | "dark"
  scroll?: ScrollTo
  target?: Target
  caption?: string
  steps?: TourStep[]
  /** set_volume: pages per month typed into the Value panel's volume box. */
  volume?: number
  /** set_volume / set_review_assumptions: the user's own review assumptions (minutes per page to check, hourly rate, price per credit). */
  reviewMinutes?: number
  hourlyRate?: number
  creditPrice?: number
}

/** The part of an action the Document viewer applies. Page is 0-based, as inside the viewer. */
export interface ViewerAction {
  doc?: string
  page?: number
  view?: ViewKind
  mode?: ParseMode
  pair?: ViewerPair
  visual?: string
  closeVisual?: boolean
  /** Which tab of the Document page: the parsed document or the Use this data tab. */
  tab?: "parsed" | "data"
  zoom?: ViewerZoom
  missedOpen?: boolean
}

export interface ViewerState {
  doc: string
  page: number
  view: ViewKind
  /** The One mode tab. */
  mode: ParseMode
  /** Key into COMPARE_PAIRS: LA (AGENTIC vs LAYOUT) or OA (AGENTIC vs OCR). */
  pairKey: string
  /** `${page}:${visualId}` as in visualKey(). */
  selectedKey: string | null
  /** Set only by a zoom action; the viewer treats a new object as a new request. */
  zoom: ViewerZoom | null
  missedOpen: boolean
}

const PAIR_KEY: Record<ViewerPair, string> = { LAYOUT: "LA", OCR: "OA" }
const DOC_RE = /^[a-z0-9_]{1,64}$/
const MODES = ["AGENTIC", "LAYOUT", "OCR"]
const MAX_CAPTION = 400
const MAX_STEPS = 8

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function parseZoom(v: unknown): ViewerZoom | undefined {
  if (v === "fit_width" || v === "fit_page") return v
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/%$/, "")) : NaN
  return Number.isFinite(n) && n >= 25 && n <= 300 ? n : undefined
}

const isPage = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1
const isTarget = (v: unknown): v is Target => typeof v === "string" && (TARGETS as readonly string[]).includes(v)
const isCaption = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= MAX_CAPTION

function parseStep(raw: unknown): TourStep | null {
  const o = asObject(raw)
  if (!o || !isTarget(o.target) || !isCaption(o.caption)) return null
  const s: TourStep = { target: o.target, caption: o.caption }
  if (o.route != null) {
    if (o.route !== "home" && o.route !== "document") return null
    s.route = o.route
  }
  if (o.doc != null) {
    if (typeof o.doc !== "string" || !DOC_RE.test(o.doc)) return null
    s.doc = o.doc
  }
  if (o.page != null) {
    if (!isPage(o.page)) return null
    s.page = o.page
  }
  return s
}

/** Validates an already-parsed action object (the app never trusts the model, even after the procedure). */
export function validateAppAction(raw: unknown): AppAction | null {
  const o = asObject(raw)
  if (!o || o.error || typeof o.action !== "string" || !(ACTIONS as readonly string[]).includes(o.action)) return null
  const a: AppAction = { action: o.action as AppActionName }
  const enumField = <K extends keyof AppAction>(key: K, src: unknown, allowed: readonly string[]): boolean => {
    if (src == null) return true
    if (typeof src !== "string" || !allowed.includes(src)) return false
    a[key] = src as AppAction[K]
    return true
  }
  if (o.doc != null) {
    if (typeof o.doc !== "string" || !DOC_RE.test(o.doc)) return null
    a.doc = o.doc
  }
  if (o.page != null) {
    if (!isPage(o.page)) return null
    a.page = o.page
  }
  if (!enumField("view", o.view, ["one", "compare"])) return null
  if (!enumField("mode", o.mode, MODES)) return null
  if (!enumField("pair", o.pair, ["LAYOUT", "OCR"])) return null
  if (!enumField("missed", o.missed, ["open", "close"])) return null
  if (!enumField("theme", o.theme, ["light", "dark"])) return null
  if (!enumField("scroll", o.scroll, ["top", "bottom", "parsed_text", "document"])) return null
  if (o.visual != null) {
    if (typeof o.visual !== "string" || !o.visual) return null
    a.visual = o.visual
  }
  if (o.zoom != null) {
    const z = parseZoom(o.zoom)
    if (z === undefined) return null
    a.zoom = z
  }
  if (o.volume != null) {
    const v = Number(o.volume)
    if (!Number.isInteger(v) || v < 1 || v > 1_000_000_000) return null
    a.volume = v
  }
  for (const [key, field] of [["review_minutes", "reviewMinutes"], ["hourly_rate", "hourlyRate"], ["credit_price", "creditPrice"]] as const) {
    if (o[key] == null) continue
    const v = Number(o[key])
    if (!Number.isFinite(v) || v <= 0 || v > (key === "review_minutes" ? 600 : 100000)) return null
    a[field] = v
  }
  if (o.compare_answers != null) {
    if (o.compare_answers !== "on" && o.compare_answers !== "off") return null
    a.compareAnswers = o.compare_answers === "on"
  }
  if (o.target != null) {
    if (!isTarget(o.target)) return null
    a.target = o.target
  }
  if (o.caption != null) {
    if (!isCaption(o.caption)) return null
    a.caption = o.caption
  }
  if (o.steps != null) {
    if (!Array.isArray(o.steps) || o.steps.length === 0 || o.steps.length > MAX_STEPS) return null
    const steps = o.steps.map(parseStep)
    if (steps.some((s) => !s)) return null
    a.steps = steps as TourStep[]
  }
  const needs: Partial<Record<AppActionName, boolean>> = {
    open_document: !!a.doc,
    set_page: a.page !== undefined,
    set_view: !!a.view,
    set_mode: !!a.mode,
    set_pair: !!a.pair,
    select_visual: !!a.doc && !!a.visual,
    zoom: a.zoom !== undefined,
    show_missed: !!a.missed,
    set_compare_answers: a.compareAnswers !== undefined,
    set_theme: !!a.theme,
    scroll: !!a.scroll,
    highlight: !!a.target && !!a.caption,
    tour: !!a.steps,
    start_tour: true,
    open_value_panel: true,
    set_volume: a.volume !== undefined,
    set_review_assumptions: a.reviewMinutes !== undefined || a.hourlyRate !== undefined || a.creditPrice !== undefined,
    open_use_data_tab: !!a.doc,
    go_home: !a.doc && a.page === undefined && !a.visual,
    open_upload: !a.doc && a.page === undefined && !a.visual,
  }
  if (needs[a.action] === false) return null
  if (a.visual && !a.doc) return null
  return a
}

/**
 * Reads an app action out of one agent stream event. Only a successful control_app
 * `response.tool_result` counts; the tool_use input is unvalidated and ignored.
 * The procedure's return value is a JSON string inside the JSON event, so it is parsed twice.
 */
export function parseAppAction(ev: { event?: string | null; data?: unknown }): AppAction | null {
  const r = toolResult(ev, "control_app")
  return r ? validateAppAction(r) : null
}

/** The parsed JSON result of a successful `name` tool, or null. */
export function toolResult(ev: { event?: string | null; data?: unknown }, name: string): Record<string, unknown> | null {
  if (ev.event !== "response.tool_result") return null
  const d = asObject(ev.data)
  if (!d || d.name !== name || d.status !== "success") return null
  const content = Array.isArray(d.content) ? d.content : []
  const json = asObject(asObject(content[0])?.json)
  if (!json) return null
  let result: unknown = json.result
  if (typeof result === "string") {
    try {
      result = JSON.parse(result)
    } catch {
      return null
    }
  }
  return asObject(result)
}

/** The viewer's share of an action, pages converted to 0-based; null when the viewer is not involved. */
export function viewerPart(a: AppAction): ViewerAction | null {
  const v: ViewerAction = {}
  if (a.doc) v.doc = a.doc
  if (a.page !== undefined) v.page = a.page - 1
  if (a.view) v.view = a.view
  if (a.mode) {
    v.mode = a.mode
    v.view ??= "one" // the mode tab only exists in One mode
  }
  if (a.pair) {
    v.pair = a.pair
    v.view ??= "compare"
  }
  if (a.visual) v.visual = a.visual
  if (a.action === "close_visual") v.closeVisual = true
  if (a.action === "open_use_data_tab") v.tab = "data"
  if (a.zoom !== undefined) v.zoom = a.zoom
  if (a.missed) v.missedOpen = a.missed === "open"
  return Object.keys(v).length ? v : null
}

export function applyViewerAction(state: ViewerState, a: ViewerAction): ViewerState {
  const next: ViewerState = { ...state }
  if (a.doc && a.doc !== state.doc) {
    next.doc = a.doc
    next.page = 0
    next.selectedKey = null
    next.missedOpen = false
  }
  if (a.page !== undefined) next.page = a.page
  if (a.view) next.view = a.view
  if (a.mode) next.mode = a.mode
  if (a.pair) next.pairKey = PAIR_KEY[a.pair]
  if (a.visual) next.selectedKey = `${next.page}:${a.visual}`
  else if (a.closeVisual) next.selectedKey = null
  else if (next.page !== state.page) next.selectedKey = null
  if (a.zoom !== undefined) next.zoom = a.zoom
  if (a.missedOpen !== undefined) next.missedOpen = a.missedOpen
  return next
}
