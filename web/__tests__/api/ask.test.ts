import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn() }))

import { querySnowflake } from "../../lib/snowflake"
import { POST } from "../../app/api/ask/route"

const req = (body: unknown) => new Request("http://x/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) })

describe("POST /api/ask", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it.each([[{ doc: "quarterly_report" }], [{ question: "q" }], [{ question: "q", doc: "Bad Doc'" }], [{ question: "x".repeat(501), doc: "a" }], ["not json"]])("400s on %j", async (b) => {
    expect((await POST(req(b))).status).toBe(400)
    expect(querySnowflake).not.toHaveBeenCalled()
  })

  it("asks each mode with bound parameters and parses answers", async () => {
    vi.mocked(querySnowflake).mockImplementation((async (sql: string, opts?: { binds?: readonly unknown[] }) => {
      if (sql.includes("PARSE_PAGES")) return opts?.binds?.[1] === "OCR" ? [] : [{ PAGE_INDEX: 0, CONTENT: "Revenue" }]
      if (sql.includes("PARSE_VISUALS")) return [{ PAGE_INDEX: 0, VISUAL_ID: "v1", IMAGE_TYPE: "chart", SUMMARY: "Q3 13.8", VISIBLE_TEXT: "", DETAILS: "{}" }]
      const prompt = String(opts?.binds?.[0])
      return [{ A: prompt.includes("VISUALS") ? '{"found":true,"answer":"$13.8M","pages":[1]}' : '{"found":false,"answer":"Not in this parse","pages":[]}' }]
    }) as typeof querySnowflake)
    const q = "What was Q3'); DROP TABLE x; --"
    const json = await (await POST(req({ question: q, doc: "quarterly_report" }))).json()
    expect(json.answers.map((a: { mode: string }) => a.mode)).toEqual(["AGENTIC", "LAYOUT", "OCR"])
    expect(json.answers[0]).toMatchObject({ found: true, answer: "$13.8M", pages: [1] })
    expect(json.answers[1]).toMatchObject({ found: false, answer: "Not in this parse" })
    expect(json.answers[2]).toMatchObject({ found: false, noParse: true })
    for (const [sql, opts] of vi.mocked(querySnowflake).mock.calls) {
      expect(sql).not.toContain("DROP TABLE")
      expect(sql).not.toContain("quarterly_report")
      expect(opts?.binds?.length).toBeGreaterThan(0)
    }
    const complete = vi.mocked(querySnowflake).mock.calls.filter(([sql]) => sql.includes("AI_COMPLETE"))
    expect(complete).toHaveLength(2)
    expect(complete[0][0]).toContain("'claude-sonnet-5-5'")
  })

  it("turns one mode's failure into an error row without failing the rest", async () => {
    vi.mocked(querySnowflake).mockImplementation((async (sql: string, opts?: { binds?: readonly unknown[] }) => {
      if (sql.includes("PARSE_PAGES") && opts?.binds?.[1] === "LAYOUT") throw new Error("boom")
      if (sql.includes("PARSE_PAGES")) return [{ PAGE_INDEX: 0, CONTENT: "x" }]
      if (sql.includes("PARSE_VISUALS")) return []
      return [{ A: '{"found":true,"answer":"ok","pages":[1]}' }]
    }) as typeof querySnowflake)
    const res = await POST(req({ question: "q", doc: "receipt_photo" }))
    expect(res.status).toBe(200)
    const { answers } = await res.json()
    expect(answers[1]).toMatchObject({ mode: "LAYOUT", found: false, error: true })
    expect(answers[0].found && answers[2].found).toBe(true)
  })
})
