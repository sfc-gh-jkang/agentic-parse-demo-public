import type { ViewKind } from "@/lib/viewer-utils"

/** What the open Document viewer shows, so "next page" or "show me the chart" resolve without naming a Document. */
export interface ViewerSnapshot {
  doc: string
  /** 0-based, as everywhere in the viewer. */
  page: number
  pageCount: number
  view: ViewKind
  /** The One mode tab, e.g. AGENTIC. */
  mode: string
  /** Mode shown against AGENTIC in Compare modes: LAYOUT or OCR. */
  pair: string
  visuals: { visualId: string; imageType: string | null }[]
  /** Visual id whose detail is open, or null. */
  openVisual: string | null
  /** e.g. "fit width (84%)" or "150%". */
  zoom: string
  missedOpen: boolean
}

export interface AppSnapshot {
  route: "home" | "document" | "other"
  viewer: ViewerSnapshot | null
  /** Document ids listed on the home page. */
  homeDocs: string[]
  compareAnswers: boolean
  theme: "light" | "dark"
  /** e.g. "highlight on score_strip" or "tour step 2 of 5 on page_buttons"; null when none. */
  spotlight: string | null
}

/** One bracketed line prepended to the user's newest message only; history stays as typed. Pages are 1-based. */
export function describeApp(s: AppSnapshot): string {
  const common = `Compare answers across modes: ${s.compareAnswers ? "on" : "off"}. Theme: ${s.theme}. Spotlight: ${s.spotlight ?? "none"}.`
  const v = s.viewer
  if (s.route === "document" && v) {
    const shown = v.view === "compare" ? `view compare, AGENTIC vs ${v.pair}` : `view one, mode tab ${v.mode}`
    const vis = v.visuals.length ? v.visuals.map((x) => `${x.visualId} (${x.imageType ?? "unknown"})`).join(", ") : "none"
    return (
      `[App state: route document. Document ${v.doc}, page ${v.page + 1} of ${v.pageCount} (pages are 1-based; ` +
      `pass page ${v.page + 1} to control_app for this page), ${shown}. Visuals on this page: ${vis}. ` +
      `Open Visual detail: ${v.openVisual ?? "none"}. Zoom: ${v.zoom}. What was missed: ${v.missedOpen ? "open" : "closed"}. ` +
      `${common} Resolve "this", "here", "the chart", "next page" and "where am I" against it.]`
    )
  }
  if (s.route === "home") {
    const docs = s.homeDocs.length ? s.homeDocs.join(", ") : "none loaded"
    return `[App state: route home (Document list, upload card, measured cost). Documents listed: ${docs}. ${common} Resolve "here" and "where am I" against it.]`
  }
  return `[App state: route ${s.route}. ${common}]`
}

export function withAppContext(question: string, s: AppSnapshot): string {
  return `${describeApp(s)}\n\n${question}`
}
