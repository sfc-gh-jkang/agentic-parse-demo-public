import { describe, expect, it } from "vitest"
import { bestBy, creditsText, estimateMonth, parseAssumption, reviewEstimate, assumptionsStore, parseValueStory, parseVolume, volumeStore, volumeText } from "../../lib/value"

// Wire shape of VALUE_STORY, with the figures measured on this account (2026-11-02): 24 scored pages.
const wire = {
  modes: [
    { mode: "OCR", credits_per_page: 0.00068, credits_per_1k_pages: 0.68, corpus_pages: 24, corpus_credits: 0.01632, facts: 494, facts_found: 472, relations: 125, relations_found: 59, pages_to_check: 15, cost_per_correct_fact: 3.4576271e-5, derivation: "d-ocr" },
    { mode: "LAYOUT", credits_per_page: 0.00366, credits_per_1k_pages: 3.66, corpus_pages: 24, corpus_credits: 0.08784, facts: 494, facts_found: 416, relations: 125, relations_found: 85, pages_to_check: 14, cost_per_correct_fact: 0.000211153846, derivation: "d-layout" },
    { mode: "AGENTIC", credits_per_page: 0.00818, credits_per_1k_pages: 8.18, corpus_pages: 24, corpus_credits: 0.19632, facts: 494, facts_found: 488, relations: 125, relations_found: 123, pages_to_check: 6, cost_per_correct_fact: 0.000402295082, derivation: "d-agentic" },
  ],
  control_docs: [{ doc: "control_contract", pages: 1, cheapest_mode: "OCR", facts_found: 12, relations_found: 0, agentic_credits_multiple: 12.03 }],
  hard_pages: { pages_total: 24, pages_hard: 17, agentic_on_hard_pages_credits: 0.13906, agentic_everywhere_credits: 0.19632, ocr_everywhere_credits: 0.01632, routed_credits: 0.15538, note: "Oracle estimate" },
  basis: "b",
}

describe("parseValueStory", () => {
  it("maps the wire shape and rejects errors", () => {
    const s = parseValueStory(wire)!
    expect(s.modes[2]).toMatchObject({ mode: "AGENTIC", creditsPerPage: 0.00818, factsFound: 488, pagesToCheck: 6 })
    expect(s.controlDocs[0]).toMatchObject({ doc: "control_contract", cheapestMode: "OCR" })
    expect(s.hardPages.pagesHard).toBe(17)
    expect(parseValueStory({ error: "x" })).toBeNull()
    expect(parseValueStory(null)).toBeNull()
  })
})

describe("estimateMonth", () => {
  const modes = parseValueStory(wire)!.modes
  it("50,000 pages = pages x measured credits per page, and pages x facts found per corpus page", () => {
    const e = Object.fromEntries(estimateMonth(modes, 50_000).map((x) => [x.mode, x]))
    expect(e.AGENTIC.monthlyCredits).toBeCloseTo(409, 6)
    expect(e.LAYOUT.monthlyCredits).toBeCloseTo(183, 6)
    expect(e.OCR.monthlyCredits).toBeCloseTo(34, 6)
    expect(e.AGENTIC.expectedFacts).toBeCloseTo((50_000 * 488) / 24, 6)
  })
})

describe("bestBy: the unfavourable numbers stay visible", () => {
  const modes = parseValueStory(wire)!.modes
  it("OCR is cheapest per correct fact; AGENTIC leaves fewest pages to check and finds most relations", () => {
    expect(bestBy(modes, "costPerCorrectFact")?.mode).toBe("OCR")
    expect(bestBy(modes, "pagesToCheck")?.mode).toBe("AGENTIC")
    expect(bestBy(modes, "relationsFound")?.mode).toBe("AGENTIC")
    expect(bestBy([], "pagesToCheck")).toBeNull()
  })
})

describe("parseVolume and creditsText", () => {
  it.each([["50,000", 50000], [" 1 200 ", 1200], ["1", 1], ["1000000000", 1e9]])("accepts %s", (t, n) => expect(parseVolume(t)).toBe(n))
  it.each([[""], ["0"], ["-5"], ["1.5"], ["abc"], ["1000000001"]])("rejects %s", (t) => expect(parseVolume(t)).toBeNull())
  it("formats credits at any scale", () => {
    expect(creditsText(409)).toBe("409")
    expect(creditsText(34)).toBe("34")
    expect(creditsText(183)).toBe("183")
    expect(creditsText(1.5)).toBe("1.5")
    expect(creditsText(2.345)).toBe("2.35")
    expect(creditsText(0.19632)).toBe("0.196")
    expect(creditsText(0.000402295)).toBe("0.000402")
  })
})

describe("volumeStore", () => {
  it("notifies subscribers and survives unsubscribe", () => {
    let calls = 0
    const off = volumeStore.subscribe(() => calls++)
    volumeStore.set(50000)
    expect(volumeStore.get()).toBe(50000)
    off()
    volumeStore.set(null)
    expect(calls).toBe(1)
  })
})

describe("reviewEstimate: the user's own assumptions, the same arithmetic as VALUE_STORY", () => {
  const modes = parseValueStory(wire)!.modes
  const by = (r: ReturnType<typeof reviewEstimate>) => Object.fromEntries(r.map((x) => [x.mode, x]))
  it("5 minutes, 60 per hour, 50,000 pages: the numbers VALUE_STORY returned on the scratch procedure", () => {
    const r = by(reviewEstimate(modes, 50_000, { minutesPerPage: 5, hourlyRate: 60, pricePerCredit: null }))
    expect(r.AGENTIC.pagesToCheckPerMonth).toBeCloseTo(12500, 4)
    expect(r.AGENTIC.reviewHours).toBeCloseTo(1041.6667, 3)
    expect(r.AGENTIC.reviewCost).toBeCloseTo(62500, 1)
    expect(r.OCR.reviewHours).toBeCloseTo(2604.1667, 3)
    expect(r.OCR.reviewCost).toBeCloseTo(156250, 1)
    expect(r.LAYOUT.reviewHours).toBeCloseTo(2430.5556, 3)
    expect(r.OCR.hoursSavedByAgentic).toBeCloseTo(1562.5, 3)
    expect(r.LAYOUT.hoursSavedByAgentic).toBeCloseTo(1388.8889, 3)
    expect(r.AGENTIC.hoursSavedByAgentic).toBeNull()
  })
  it("credits are never turned into money without a price per credit, and a total needs both", () => {
    const noPrice = by(reviewEstimate(modes, 50_000, { minutesPerPage: 5, hourlyRate: 60, pricePerCredit: null }))
    expect(noPrice.AGENTIC.creditsCost).toBeNull()
    expect(noPrice.AGENTIC.totalCost).toBeNull()
    expect(noPrice.AGENTIC.monthlyCredits).toBeCloseTo(409, 6)
    const priced = by(reviewEstimate(modes, 50_000, { minutesPerPage: 5, hourlyRate: 60, pricePerCredit: 2 }))
    expect(priced.AGENTIC.creditsCost).toBeCloseTo(818, 6)
    expect(priced.AGENTIC.totalCost).toBeCloseTo(63318, 1)
  })
  it("with nothing assumed there is no review figure at all", () => {
    const r = by(reviewEstimate(modes, 50_000, { minutesPerPage: null, hourlyRate: null, pricePerCredit: null }))
    expect(r.AGENTIC.reviewHours).toBeNull()
    expect(r.AGENTIC.reviewCost).toBeNull()
    expect(r.OCR.hoursSavedByAgentic).toBeNull()
  })
  it("states its arithmetic", () => {
    const d = by(reviewEstimate(modes, 50_000, { minutesPerPage: 5, hourlyRate: 60, pricePerCredit: null })).AGENTIC.derivation
    expect(d).toContain("6 of 24 corpus pages to check x 50,000 pages per month = 12,500.0 pages to check per month")
    expect(d).toContain("x 5 minutes / 60 = 1,041.7 review hours")
    expect(d).toContain("x 60 per hour = 62,500.00 review cost")
  })
})

describe("parseAssumption", () => {
  it.each([["5", 5], ["60.5", 60.5], ["1,200", 1200], ["", null]])("accepts %j", (t, n) => expect(parseAssumption(t, 100000)).toBe(n))
  it.each([["0"], ["-1"], ["abc"], ["600.1"]])("rejects %s", (t) => expect(parseAssumption(t, 600)).toBeUndefined())
})

describe("assumptionsStore", () => {
  it("patches and resets, notifying subscribers", () => {
    let n = 0
    const off = assumptionsStore.subscribe(() => n++)
    assumptionsStore.set({ minutesPerPage: 5 })
    assumptionsStore.set({ hourlyRate: 60 })
    expect(assumptionsStore.get()).toEqual({ minutesPerPage: 5, hourlyRate: 60, pricePerCredit: null })
    assumptionsStore.reset()
    expect(assumptionsStore.get().minutesPerPage).toBeNull()
    off()
    expect(n).toBe(3)
  })
})

describe("reviewEstimate rounding", () => {
  it("hours saved against OCR is 1,562.5 exactly, not 1,562.4999", () => {
    const r = reviewEstimate(parseValueStory(wire)!.modes, 50_000, { minutesPerPage: 5, hourlyRate: 60, pricePerCredit: null })
    expect(r.find((x) => x.mode === "OCR")!.hoursSavedByAgentic).toBe(1562.5)
  })
})

describe("volumeText", () => {
  it("keeps what the user is typing when it already means the stored volume", () => {
    expect(volumeText("50000", 50000)).toBe("50000")
    expect(volumeText("50,000", 50000)).toBe("50,000")
  })
  it("keeps a half-typed or invalid entry when the store was cleared by that entry", () => {
    expect(volumeText("1e", null)).toBe("1e")
    expect(volumeText("1000000000000", null)).toBe("1000000000000")
    expect(volumeText("", null)).toBe("")
  })
  it("formats a volume set from elsewhere (the Demo Agent's set_volume)", () => {
    expect(volumeText("", 12000)).toBe("12,000")
    expect(volumeText("500", 12000)).toBe("12,000")
  })
})
