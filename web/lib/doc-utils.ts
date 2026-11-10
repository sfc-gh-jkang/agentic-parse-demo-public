import type { VisualMatch } from "@/lib/viewer-utils"

export const PARSE_MODES = ["OCR", "LAYOUT", "AGENTIC"] as const
export type ParseMode = (typeof PARSE_MODES)[number]

/** quarterly_report → "Quarterly Report"; up_my_receipt_4f2a9c → "My Receipt · 4f2a9c" (the suffix keeps uploads apart). */
export function prettifyDocId(docId: string): string {
  const up = /^up_(.+)_([0-9a-f]{6})$/.exec(docId)
  if (up) return `${prettifyDocId(up[1])} · ${up[2]}`
  return docId
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

export interface DocumentSummary {
  docId: string
  source: string
  fileType: string
  addedAt: string | null
  pages: number | null
  modesParsed: string[]
  lastParsedAt: string | null
  hasGroundTruth: boolean
}

export interface RunPage { index: number; content: string; width: number | null; height: number | null }
export interface ModeRun { mode: ParseMode; runId: string; finishedAt: string | null; pages: RunPage[] }

export interface ModeCost {
  mode: string
  runs: number
  measuredRuns: number
  pendingRuns: number
  pagesBilled: number | null
  credits: number | null
  creditsPer1kPages: number | null
  measuredAt: string | null
}

export interface Visual {
  visualId: string
  page: number
  imageType: string | null
  summary: string
  visibleText: string
  details: any
  failed: boolean
  x0: number | null
  y0: number | null
  x1: number | null
  y1: number | null
}

export interface ModeComparison {
  mode: ParseMode
  runId: string
  scoredAt: string | null
  imageFacts: number
  imageFactsFound: number
  textFacts: number
  textFactsFound: number
  relations: number
  relationsFound: number
  visualsExpected: number
  visualsDetected: number
  matches: VisualMatch[]
  missed: { facts: { page: number; channel: string; fact: string }[]; visuals: string[] }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body as T
}
