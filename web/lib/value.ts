/** Types and pure math for the Value panel. The numbers come from VALUE_STORY (stored data); nothing here is a constant of the corpus. */
export interface ValueMode {
  mode: string
  creditsPerPage: number
  creditsPer1kPages: number
  corpusPages: number
  corpusCredits: number
  facts: number
  factsFound: number
  relations: number
  relationsFound: number
  pagesToCheck: number
  costPerCorrectFact: number
  derivation: string
}

export interface ControlDoc { doc: string; pages: number; cheapestMode: string; factsFound: number; relationsFound: number; agenticCreditsMultiple: number }

export interface HardPages {
  pagesTotal: number
  pagesHard: number
  agenticOnHardPagesCredits: number
  agenticEverywhereCredits: number
  ocrEverywhereCredits: number
  routedCredits: number
  note: string
}

export interface ValueStory { modes: ValueMode[]; controlDocs: ControlDoc[]; hardPages: HardPages; basis: string }

/** Wire (snake_case, as VALUE_STORY returns it) to camelCase. */
export function parseValueStory(raw: unknown): ValueStory | null {
  const o = raw as Record<string, any> | null
  if (!o || o.error || !Array.isArray(o.modes) || !o.hard_pages) return null
  const n = (v: unknown) => Number(v)
  return {
    modes: o.modes.map((m: any) => ({
      mode: String(m.mode), creditsPerPage: n(m.credits_per_page), creditsPer1kPages: n(m.credits_per_1k_pages),
      corpusPages: n(m.corpus_pages), corpusCredits: n(m.corpus_credits), facts: n(m.facts), factsFound: n(m.facts_found),
      relations: n(m.relations), relationsFound: n(m.relations_found), pagesToCheck: n(m.pages_to_check),
      costPerCorrectFact: n(m.cost_per_correct_fact), derivation: String(m.derivation),
    })),
    controlDocs: (o.control_docs ?? []).map((c: any) => ({
      doc: String(c.doc), pages: n(c.pages), cheapestMode: String(c.cheapest_mode), factsFound: n(c.facts_found),
      relationsFound: n(c.relations_found), agenticCreditsMultiple: n(c.agentic_credits_multiple),
    })),
    hardPages: {
      pagesTotal: n(o.hard_pages.pages_total), pagesHard: n(o.hard_pages.pages_hard),
      agenticOnHardPagesCredits: n(o.hard_pages.agentic_on_hard_pages_credits), agenticEverywhereCredits: n(o.hard_pages.agentic_everywhere_credits),
      ocrEverywhereCredits: n(o.hard_pages.ocr_everywhere_credits), routedCredits: n(o.hard_pages.routed_credits), note: String(o.hard_pages.note),
    },
    basis: String(o.basis ?? ""),
  }
}

/** The reader's own numbers. Nothing here has a default: an empty box means "not assumed". */
export interface ReviewAssumptions { minutesPerPage: number | null; hourlyRate: number | null; pricePerCredit: number | null }
export const NO_ASSUMPTIONS: ReviewAssumptions = { minutesPerPage: null, hourlyRate: null, pricePerCredit: null }

export interface ReviewEstimate {
  mode: string
  monthlyCredits: number
  pagesToCheckPerMonth: number
  reviewHours: number | null
  reviewCost: number | null
  creditsCost: number | null
  totalCost: number | null
  hoursSavedByAgentic: number | null
  derivation: string
}

const f = (v: number, digits = 1) => v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })

/**
 * Per Parse Mode, at a monthly volume: AI credits (credits, never money unless the reader gave a price per credit) plus the human
 * review of pages left to check. pages to check per month = (pages to check / corpus pages) x volume; hours = that x minutes / 60;
 * review cost = hours x rate. Mirrors VALUE_STORY(pages, minutes, rate, price). Totals need BOTH a rate and a credit price.
 */
export function reviewEstimate(modes: ValueMode[], pagesPerMonth: number, a: ReviewAssumptions): ReviewEstimate[] {
  const base = modes.map((m) => {
    const check = m.corpusPages > 0 ? (m.pagesToCheck / m.corpusPages) * pagesPerMonth : 0
    return { m, check, credits: pagesPerMonth * m.creditsPerPage, hours: a.minutesPerPage == null ? null : Math.round((check * a.minutesPerPage * 1e6) / 60) / 1e6 }
  })
  const agenticHours = base.find((b) => b.m.mode === "AGENTIC")?.hours ?? null
  return base.map(({ m, check, credits, hours }) => {
    const reviewCost = hours != null && a.hourlyRate != null ? hours * a.hourlyRate : null
    const creditsCost = a.pricePerCredit != null ? credits * a.pricePerCredit : null
    const parts = [`${m.pagesToCheck} of ${m.corpusPages} corpus pages to check x ${pagesPerMonth.toLocaleString("en-US")} pages per month = ${f(check)} pages to check per month`]
    if (hours != null) parts.push(`x ${a.minutesPerPage} minutes / 60 = ${f(hours)} review hours`)
    if (reviewCost != null) parts.push(`x ${a.hourlyRate} per hour = ${f(reviewCost, 2)} review cost`)
    if (creditsCost != null) parts.push(`${f(credits, 2)} credits x ${a.pricePerCredit} per credit = ${f(creditsCost, 2)} AI cost`)
    return {
      mode: m.mode, monthlyCredits: credits, pagesToCheckPerMonth: check, reviewHours: hours, reviewCost, creditsCost,
      totalCost: reviewCost != null && creditsCost != null ? reviewCost + creditsCost : null,
      hoursSavedByAgentic: hours != null && agenticHours != null && m.mode !== "AGENTIC" ? Math.round((hours - agenticHours) * 1e6) / 1e6 : null,
      derivation: parts.join("; "),
    }
  })
}

/** Parses a positive decimal assumption box (minutes, rate, price): commas allowed; empty is "not assumed" (null); invalid is undefined. */
export function parseAssumption(text: string, max: number): number | null | undefined {
  const t = text.replace(/[,\s_]/g, "")
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 && n <= max ? n : undefined
}

export interface MonthlyEstimate { mode: string; monthlyCredits: number; expectedFacts: number }

/** pages x measured credits per page; pages x facts found per corpus page. An estimate: another mix of Documents will differ. */
export function estimateMonth(modes: ValueMode[], pagesPerMonth: number): MonthlyEstimate[] {
  return modes.map((m) => ({
    mode: m.mode,
    monthlyCredits: pagesPerMonth * m.creditsPerPage,
    expectedFacts: m.corpusPages > 0 ? (pagesPerMonth * m.factsFound) / m.corpusPages : 0,
  }))
}

/**
 * What the volume box should show for the stored volume. The box writes the store on every keystroke and the store
 * echoes back, so text that already means the stored value (or an invalid entry that cleared it) is kept as typed;
 * only a volume set elsewhere (the Demo Agent's set_volume) is reformatted.
 */
export function volumeText(text: string, volume: number | null): string {
  if (parseVolume(text) === volume) return text
  return volume ? volume.toLocaleString("en-US") : ""
}

/** Parses the volume box: whole pages, 1 to 1,000,000,000; commas and spaces allowed. */
export function parseVolume(text: string): number | null {
  const n = Number(text.replace(/[,\s_]/g, ""))
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000_000 ? n : null
}

export function creditsText(v: number): string {
  if (v >= 100) return v.toLocaleString("en-US", { maximumFractionDigits: 0 })
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 })
  if (v >= 0.01) return v.toFixed(3)
  return v.toPrecision(3)
}

/** The fewest-pages-to-check mode, and the cheapest cost per correct fact: shown side by side, never merged into one "winner". */
export function bestBy(modes: ValueMode[], key: "pagesToCheck" | "costPerCorrectFact" | "relationsFound"): ValueMode | null {
  if (!modes.length) return null
  return [...modes].sort((a, b) => (key === "relationsFound" ? b.relationsFound - a.relationsFound : a[key] - b[key]))[0]
}

export function valueFetchPath(pages?: number | null): string {
  return pages ? `/api/value?pages=${pages}` : "/api/value"
}

// Shared by the panel and the Demo Agent (action set_volume): the volume typed or requested, kept across route changes.
type Listener = () => void
let volume: number | null = null
const listeners = new Set<Listener>()
export const volumeStore = {
  get: () => volume,
  set(v: number | null) { volume = v; listeners.forEach((l) => l()) },
  subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l) } },
}

// The reader's review assumptions, shared by the panel and the Demo Agent (set_volume / set_review_assumptions).
let assumptions: ReviewAssumptions = NO_ASSUMPTIONS
const aListeners = new Set<Listener>()
export const assumptionsStore = {
  get: () => assumptions,
  set(patch: Partial<ReviewAssumptions>) { assumptions = { ...assumptions, ...patch }; aListeners.forEach((l) => l()) },
  reset() { assumptions = NO_ASSUMPTIONS; aListeners.forEach((l) => l()) },
  subscribe(l: Listener) { aListeners.add(l); return () => { aListeners.delete(l) } },
}
