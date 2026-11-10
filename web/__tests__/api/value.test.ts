import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn() }))

import { querySnowflake } from "../../lib/snowflake"
import { GET } from "../../app/api/value/route"
import { POST } from "../../app/api/use-data/run/route"

const story = {
  modes: [{ mode: "AGENTIC", credits_per_page: 0.00818, credits_per_1k_pages: 8.18, corpus_pages: 24, corpus_credits: 0.19632, facts: 494, facts_found: 488, relations: 125, relations_found: 123, pages_to_check: 6, cost_per_correct_fact: 0.000402, derivation: "d" }],
  control_docs: [],
  hard_pages: { pages_total: 24, pages_hard: 17, agentic_on_hard_pages_credits: 1, agentic_everywhere_credits: 2, ocr_everywhere_credits: 0.5, routed_credits: 1.5, note: "n" },
}

describe("GET /api/value", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}) })
  it("calls VALUE_STORY with a bound volume and returns camelCase", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([{ VALUE_STORY: JSON.stringify(story) }])
    const json = await (await GET(new Request("http://x/api/value?pages=50000"))).json()
    expect(json.modes[0]).toMatchObject({ mode: "AGENTIC", factsFound: 488 })
    const [sql, opts] = vi.mocked(querySnowflake).mock.calls[0]
    expect(sql).toContain("VALUE_STORY(?)")
    expect(opts).toEqual({ binds: [50000] })
  })
  it("rejects a bad volume before touching Snowflake", async () => {
    for (const p of ["0", "-1", "1.5", "abc", "2000000000"]) expect((await GET(new Request(`http://x/api/value?pages=${p}`))).status).toBe(400)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
  it("404 when nothing is scored, 500 on failure", async () => {
    vi.mocked(querySnowflake).mockResolvedValueOnce([{ VALUE_STORY: JSON.stringify({ error: "x" }) }])
    expect((await GET(new Request("http://x/api/value"))).status).toBe(404)
    vi.mocked(querySnowflake).mockRejectedValueOnce(new Error("nope"))
    expect((await GET(new Request("http://x/api/value"))).status).toBe(500)
  })
})

const post = (body: unknown) => POST(new Request("http://x/api/use-data/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))

describe("POST /api/use-data/run", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}) })
  it("runs a read snippet and returns rows", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([{ PAGE: 1, CHARS: 10 }])
    const json = await (await post({ snippet: "pages", doc: "quarterly_report" })).json()
    expect(json).toMatchObject({ columns: ["PAGE", "CHARS"], billed: false })
    expect(vi.mocked(querySnowflake).mock.calls[0][0]).toContain("DOC_ID = 'quarterly_report'")
  })
  it("never runs the pattern, an unknown snippet or SQL from the caller", async () => {
    for (const body of [{ snippet: "dynamic_table", doc: "a" }, { snippet: "SELECT 1", doc: "a" }, { sql: "DROP TABLE x", doc: "a" }]) expect((await post(body)).status).toBe(400)
    expect((await post({ snippet: "pages", doc: "a'; DROP TABLE x; --" })).status).toBe(400)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
  it("billed snippet asks first: unconfirmed returns the size and bills nothing", async () => {
    vi.mocked(querySnowflake).mockResolvedValueOnce([{ CONTENT: "x".repeat(4000) }])
    vi.mocked(querySnowflake).mockResolvedValueOnce([{ CALLS: 1, TOKENS: 305, CREDITS: "0.00169275" }])
    const json = await (await post({ snippet: "ai_extract", doc: "quarterly_report" })).json()
    expect(json).toMatchObject({ needsConfirm: true, inputChars: 4000, approxInputTokens: 1000 })
    expect(json.measuredRate.calls).toBe(1)
    expect(json.measuredRate.creditsPerMillionTokens).toBeCloseTo(5.55, 2)
    expect(json.estimatedCredits).toBeCloseTo(0.00555, 5) // 1,000 tokens x 5.55 credits per million
    // only the input text and the usage history were read: nothing billed ran
    for (const [sql] of vi.mocked(querySnowflake).mock.calls) expect(sql).not.toMatch(/AI_EXTRACT\(/)
  })
  it("a missing usage rate is shown as unknown, never invented", async () => {
    vi.mocked(querySnowflake).mockResolvedValueOnce([{ CONTENT: "x".repeat(400) }])
    vi.mocked(querySnowflake).mockRejectedValueOnce(new Error("no access"))
    const json = await (await post({ snippet: "ai_extract", doc: "quarterly_report" })).json()
    expect(json).toMatchObject({ needsConfirm: true, measuredRate: null, estimatedCredits: null })
  })
  it("billed snippet runs only with confirm=true", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([{ EXTRACTED: "{}" }])
    const json = await (await post({ snippet: "ai_extract", doc: "quarterly_report", confirm: true })).json()
    expect(json.billed).toBe(true)
    expect(vi.mocked(querySnowflake).mock.calls[0][0]).toContain("AI_EXTRACT")
  })
})
