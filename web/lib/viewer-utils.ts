import type { ParseMode } from "@/lib/doc-utils"

export type ViewKind = "one" | "compare"

export interface Bbox { x0: number | null; y0: number | null; x1: number | null; y1: number | null }

const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, n)) * 10000) / 100}%`

/** CSS percentages for a normalized bbox. A missing or partial box (image files) covers the whole image. */
export function boxStyle(b: Bbox): { left: string; top: string; width: string; height: string } {
  const { x0, y0, x1, y1 } = b
  if (x0 == null || y0 == null || x1 == null || y1 == null) return { left: "0%", top: "0%", width: "100%", height: "100%" }
  const l = Math.min(1, Math.max(0, x0))
  const t = Math.min(1, Math.max(0, y0))
  const r = Math.min(1, Math.max(0, x1))
  const bt = Math.min(1, Math.max(0, y1))
  return { left: pct(l), top: pct(t), width: pct(r - l), height: pct(bt - t) }
}

// AGENTIC is always one side and always on the left.
export const COMPARE_PAIRS: { key: string; label: string; modes: [ParseMode, ParseMode] }[] = [
  { key: "LA", label: "AGENTIC vs LAYOUT", modes: ["AGENTIC", "LAYOUT"] },
  { key: "OA", label: "AGENTIC vs OCR", modes: ["AGENTIC", "OCR"] },
]

export function modesForView(view: ViewKind, single: ParseMode, pairKey: string): ParseMode[] {
  if (view === "one") return [single]
  return (COMPARE_PAIRS.find((p) => p.key === pairKey) ?? COMPARE_PAIRS[0]).modes
}

export const DIVIDER_MIN = 25
export const DIVIDER_MAX = 80

/**
 * Tailwind classes for the viewer / parsed-text split. Below md (768px) the panes stack,
 * viewer above parsed text, each full width; from md up they sit side by side, with the
 * widths and height read from the --split and --split-h CSS variables set inline.
 */
export const SPLIT_CLASSES = {
  wrap: "flex flex-col gap-3 md:h-[var(--split-h)] md:flex-row md:gap-0",
  viewer: "h-[60vh] min-h-[320px] w-full min-w-0 shrink-0 md:h-auto md:min-h-0 md:w-[var(--split)]",
  divider: "group hidden w-3 shrink-0 cursor-col-resize touch-none items-center justify-center md:flex",
  text: "flex h-[75vh] min-h-[360px] w-full min-w-0 flex-col gap-2 md:h-auto md:min-h-0 md:w-auto md:flex-1",
} as const

export function defaultDividerPct(view: ViewKind): number {
  return view === "one" ? 65 : 40
}

/** Clamp to the allowed range; null for a non-numeric value (bad localStorage). */
export function clampDividerPct(v: number): number | null {
  if (!Number.isFinite(v)) return null
  return Math.min(DIVIDER_MAX, Math.max(DIVIDER_MIN, v))
}

export interface VisualMatch {
  visual_id?: string | null
  page?: number
  title?: string
  facts?: number
  facts_found?: number
  missed?: string[]
}

/** Visual ids such as img-0.jpeg repeat across pages, so the page is part of the identity. */
export function visualKey(v: { visualId: string; page: number }): string {
  return `${v.page}:${v.visualId}`
}

export function matchForVisual(matches: VisualMatch[], visualId: string, page: number): VisualMatch | undefined {
  return matches.find((m) => m.visual_id === visualId && m.page === page)
}

export function formatScore(found: number | null, total: number | null): string {
  if (found == null || total == null) return "n/a"
  return `${found}/${total}`
}

const PLACEHOLDER_MAX = 80

/**
 * Label for the spot where AGENTIC markdown places a Visual (`![img-0.jpeg](img-0.jpeg)`).
 * `visual` is undefined when the markdown references an image AGENTIC did not report.
 */
export function visualPlaceholderLabel(
  visual: { visualId: string; imageType: string | null; summary: string; details: any } | undefined,
  visualId = visual?.visualId ?? "",
  mode = "AGENTIC",
): string {
  if (!visual) return mode === "AGENTIC" ? `Image ${visualId} (not reported as a Visual)` : `Image (${mode} does not describe images)`
  const type = (visual.imageType ?? "visual").replace(/_/g, " ")
  const prefix = `${type.charAt(0).toUpperCase()}${type.slice(1)}: `
  const title = typeof visual.details?.title === "string" && visual.details.title.trim() ? visual.details.title : ""
  const text = (title || visual.summary || "").trim()
  const room = PLACEHOLDER_MAX - prefix.length
  return prefix + (text.length > room ? `${text.slice(0, room - 1)}…` : text)
}

/** Top offset of the Visual detail: just below the Visual's box (under the whole page when it has no bbox). */
export function detailTopStyle(b: Bbox): string {
  const st = boxStyle(b)
  return `calc(${st.top} + ${st.height} + 14px)`
}

/** Clicking the selected Visual (box or chip) again closes its detail. */
export function toggleSelection(current: string | null, key: string): string | null {
  return current === key ? null : key
}

/** How the browser can show a stored file: PDF via pdf.js, PNG/JPG as an image, anything else not at all. */
export function previewKind(fileType: string): "pdf" | "image" | "none" {
  const t = fileType.toLowerCase()
  if (t === "pdf") return "pdf"
  if (t === "png" || t === "jpg" || t === "jpeg") return "image"
  return "none"
}

/** One mode opens on AGENTIC; an upload parsed only in LAYOUT or OCR opens on the best mode it has. */
export function initialMode<M extends string>(available: readonly M[], preference: readonly M[]): M | null {
  return preference.find((m) => available.includes(m)) ?? null
}

export interface MissedGroup {
  label: string
  items: string[]
}

/** "What was missed" for one Parse Mode, grouped: undetected Visuals first, then facts per page. */
export function groupMissed(missed: { visuals: unknown[]; facts: { page: number; channel: string; fact: string }[] }): MissedGroup[] {
  const groups: MissedGroup[] = []
  if (missed.visuals.length) groups.push({ label: "Visuals not detected", items: missed.visuals.map(String) })
  const byPage = new Map<number, string[]>()
  for (const f of missed.facts) byPage.set(f.page, [...(byPage.get(f.page) ?? []), `${f.channel}: ${f.fact}`])
  for (const [page, items] of [...byPage].sort((a, b) => a[0] - b[0])) groups.push({ label: `Page ${page + 1}`, items })
  return groups
}

/** Parse Modes in display order for side-by-side panels: AGENTIC always leftmost. */
export function agenticFirst<T extends { mode: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(b.mode === "AGENTIC") - Number(a.mode === "AGENTIC"))
}
