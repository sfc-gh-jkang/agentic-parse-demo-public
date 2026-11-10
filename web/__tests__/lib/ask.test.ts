import { describe, expect, it } from "vitest"
import { showCompareResult, ASK_SAMPLES, MAX_QUESTION, NOT_FOUND, buildContext, buildPrompt, citedDocs, cleanQuestion, compareAfterAgent, isViewerCommand, loadComparePref, namedDoc, parseAnswer, pickAskDocNow, saveComparePref } from "../../lib/ask"

const known = new Set(["quarterly_report", "claim_packet", "receipt_photo", "inspection_form", "floor_plan_diagram", "stamped_invoice", "pitch_deck"])

describe("cleanQuestion", () => {
  it("trims", () => expect(cleanQuestion("  hi ")).toBe("hi"))
  it.each([[""], ["   "], [42], [null], ["x".repeat(MAX_QUESTION + 1)]])("rejects %j", (q) => expect(cleanQuestion(q)).toBeNull())
  it("accepts the cap", () => expect(cleanQuestion("x".repeat(MAX_QUESTION))).toHaveLength(MAX_QUESTION))
})

describe("buildContext / buildPrompt", () => {
  it("marks 1-based pages and appends AGENTIC visuals", () => {
    const ctx = buildContext([{ PAGE_INDEX: 0, CONTENT: "a" }, { PAGE_INDEX: 1, CONTENT: null }], [{ PAGE_INDEX: 0, VISUAL_ID: "v1", IMAGE_TYPE: "chart", SUMMARY: "Revenue", VISIBLE_TEXT: "Q3", DETAILS: { y: 13.8 } }])
    expect(ctx).toContain("[Page 1]\na")
    expect(ctx).toContain("[Page 2]\n")
    expect(ctx).toContain('[Page 1] chart v1: Revenue Q3 {"y":13.8}')
  })
  it("omits the visuals block when there are none and caps length", () => {
    expect(buildContext([{ PAGE_INDEX: 0, CONTENT: "x".repeat(70_000) }])).toHaveLength(60_000)
    expect(buildContext([{ PAGE_INDEX: 0, CONTENT: "a" }])).not.toContain("VISUALS")
  })
  it("asks for units, one sentence, and the not-found phrase", () => {
    const p = buildPrompt("Q3?", "OCR", "ctx")
    expect(p).toMatch(/units and labels/)
    expect(p).toMatch(/one sentence/)
    expect(p).toMatch(/Do not deduce/)
    expect(p).toContain(NOT_FOUND)
    expect(p).toContain("(OCR mode)")
    expect(p.endsWith("ctx")).toBe(true)
  })
})

describe("parseAnswer", () => {
  it("reads JSON wrapped in prose or fences", () => {
    expect(parseAnswer('```json\n{"found": true, "answer": "$13.8M", "pages": [1, 1, 9, "2"]}\n```', 2)).toEqual({ found: true, answer: "$13.8M", pages: [1, 2] })
  })
  it("treats found:false as not found", () => {
    expect(parseAnswer('{"found": false, "answer": "whatever", "pages": [1]}', 3)).toEqual({ found: false, answer: NOT_FOUND, pages: [] })
  })
  it("treats a not-in-this-parse answer as not found even when found is true", () => {
    expect(parseAnswer('{"found": true, "answer": "Not in this parse."}', 1).found).toBe(false)
    expect(parseAnswer("Not found in the parse", 1).found).toBe(false)
  })
  it("falls back to raw text and extracts page mentions", () => {
    expect(parseAnswer("Total is $29.45 (page 1)", 1)).toEqual({ found: true, answer: "Total is $29.45 (page 1)", pages: [1] })
  })
  it("survives broken JSON and empty replies", () => {
    expect(parseAnswer("{oops p. 3", 4)).toEqual({ found: true, answer: "{oops p. 3", pages: [3] })
    expect(parseAnswer("", 1).found).toBe(false)
  })
})

describe("doc selection", () => {
  it("prefers a Document the question names over the open one", () => {
    expect(pickAskDocNow("In claim_packet, what does the note say?", "quarterly_report", known)).toEqual({ doc: "claim_packet", source: "named" })
  })
  it("recognises names written with spaces or a possessive", () => {
    expect(namedDoc("What is the invoice number on the stamped invoice?", known)).toBe("stamped_invoice")
    expect(namedDoc("Q4 revenue in the quarterly report's chart", known)).toBe("quarterly_report")
    expect(namedDoc("In the floor plan diagram, what does P1 connect to?", known)).toBe("floor_plan_diagram")
    expect(namedDoc("the floor plan", known)).toBeNull()
    expect(namedDoc("an invoice that was stamped", known)).toBeNull()
  })
  it("uses the open Document otherwise", () => expect(pickAskDocNow("Q3 revenue?", "quarterly_report", known)).toEqual({ doc: "quarterly_report", source: "viewer" }))
  it("returns null with no named or open Document", () => expect(pickAskDocNow("Q3 revenue?", null, known)).toBeNull())
  it("ignores names before the Document list loads", () => expect(pickAskDocNow("claim_packet?", null, undefined)).toBeNull())
  it("lists cited Documents in order without repeats", () => {
    expect(citedDocs("It is $29.45 (receipt_photo, page 1), see (claim_packet, page 2) and (receipt_photo, page 1)", known)).toEqual(["receipt_photo", "claim_packet"])
    expect(citedDocs("See (GLOSSARY.md)", known)).toEqual([])
  })
  it("falls back to Documents the agent opened in the viewer", () => {
    expect(citedDocs("Source: receipt_photo, page 1.", known, [{ doc: "receipt_photo" }, {}])).toEqual(["receipt_photo"])
    expect(citedDocs("(claim_packet, page 1)", known, [{ doc: "receipt_photo" }, { doc: "nope_doc" }])).toEqual(["claim_packet", "receipt_photo"])
  })
  it("every sample names its own Document and is not a command", () => {
    for (const s of ASK_SAMPLES) {
      expect(pickAskDocNow(s.q, "pitch_deck", known)?.doc).toBe(s.doc)
      expect(isViewerCommand(s.q)).toBe(false)
    }
  })
})

describe("isViewerCommand", () => {
  it.each(["next page", "zoom in", "Show me page 2 of claim_packet in compare view against OCR", "yes, go ahead", "no, cancel that", "Re-parse the floor plan diagram with OCR", "close that", "go back to one mode"])("skips %s", (q) => expect(isViewerCommand(q)).toBe(true))
  it.each(["What did I just ask you about?", "what was my question", "Remind me of my last question?"])("D3: skips chat-history question %s", (q) => expect(isViewerCommand(q)).toBe(true))
  it.each(["take me to the homepage", "give me a tour of this screen", "where am I?", "explain that relations number", "switch to dark mode", "what was missed?", "turn off the compare answers", "take me to upload"])("T18: skips app request %s", (q) => expect(isViewerCommand(q)).toBe(true))
  it.each(["What does Panel P1 connect to?", "what about the whiteboard photo, what's on it?", "Show me what the sticky note says?", "Is the guard checked?"])("keeps %s", (q) => expect(isViewerCommand(q)).toBe(false))
})

describe("compareAfterAgent", () => {
  const viewer = { doc: "quarterly_report", source: "viewer" as const }
  const named = { doc: "claim_packet", source: "named" as const }
  it("hides when the agent never searched parsed Documents", () => expect(compareAfterAgent(viewer, ["mode_scores"], ["claim_packet"])).toEqual({ kind: "hide" }))
  it("keeps a named Document even if the agent cites another", () => expect(compareAfterAgent(named, ["parsed_documents"], ["receipt_photo"])).toEqual({ kind: "keep" }))
  it("re-grounds a viewer guess on the Document the agent cited", () => expect(compareAfterAgent(viewer, ["parsed_documents"], ["stamped_invoice"])).toEqual({ kind: "run", doc: "stamped_invoice" }))
  it("keeps the viewer Document when the agent cited it", () => expect(compareAfterAgent(viewer, ["parsed_documents", "control_viewer"], ["stamped_invoice", "quarterly_report"])).toEqual({ kind: "keep" }))
  it("starts on the cited Document when none was known", () => expect(compareAfterAgent(null, ["parsed_documents"], ["receipt_photo"])).toEqual({ kind: "run", doc: "receipt_photo" }))
  it("shows the hint when there is nothing to ground on", () => expect(compareAfterAgent(null, ["parsed_documents"], [])).toEqual({ kind: "nodoc" }))
})

describe("compare preference", () => {
  it("defaults on and remembers off", () => {
    const m = new Map<string, string>()
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    expect(loadComparePref(store)).toBe(true)
    saveComparePref(false, store)
    expect(loadComparePref(store)).toBe(false)
    saveComparePref(true, store)
    expect(loadComparePref(store)).toBe(true)
  })
})

describe("showCompareResult", () => {
  const res = (found: boolean[]) => ({ doc: "d", question: "q", totalMs: 1, answers: found.map((f, i) => ({ mode: (["AGENTIC", "LAYOUT", "OCR"] as const)[i], found: f, answer: "x", pages: [], ms: 1 })) })
  it("shows any table with an answer", () => expect(showCompareResult(res([true, false, false]), "", false, known)).toBe(true))
  it("waits for the agent before showing an all-miss table", () => expect(showCompareResult(res([false, false, false]), "(claim_packet, page 1)", false, known)).toBe(false))
  it("shows an all-miss table when the agent cited a page", () => expect(showCompareResult(res([false, false, false]), "No signatory (claim_packet, page 1)", true, known)).toBe(true))
  it("hides an all-miss table when the agent cited no page", () => expect(showCompareResult(res([false, false, false]), "AGENTIC scored 123/125 (Mode Comparison)", true, known)).toBe(false))
})
