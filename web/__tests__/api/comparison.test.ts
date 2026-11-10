import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn() }))

import { querySnowflake } from "../../lib/snowflake"
import { GET } from "../../app/api/documents/[id]/comparison/route"

const call = (id: string) => GET(new Request("http://x/api"), { params: Promise.resolve({ id }) })
const row = (mode: string, over: Record<string, unknown> = {}) => ({
  MODE: mode, IMAGE_FACTS: 6, IMAGE_FACTS_FOUND: 5, TEXT_FACTS: 4, TEXT_FACTS_FOUND: 4,
  RELATIONS: 13, RELATIONS_FOUND: 13, VISUALS_EXPECTED: 3, VISUALS_DETECTED: 3,
  MATCHES: [{ visual_id: "v1", title: "Chart", facts: 3, facts_found: 3, missed: [] }],
  MISSED: { facts: [{ page: 0, channel: "image", fact: "Q3 = 12" }], visuals: [] },
  RUN_ID: "r1", SCORED_AT: new Date("2026-10-30T13:00:00Z"), ...over,
})

describe("GET /api/documents/[id]/comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("returns Mode Comparison rows in OCR, LAYOUT, AGENTIC order with camelCase counts", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([row("AGENTIC"), row("OCR"), row("LAYOUT")])
    const json = await (await call("quarterly_report")).json()
    expect(json.comparisons.map((c: any) => c.mode)).toEqual(["OCR", "LAYOUT", "AGENTIC"])
    expect(json.comparisons[2]).toEqual({
      mode: "AGENTIC", runId: "r1", scoredAt: "2026-10-30T13:00:00.000Z",
      imageFacts: 6, imageFactsFound: 5, textFacts: 4, textFactsFound: 4,
      relations: 13, relationsFound: 13, visualsExpected: 3, visualsDetected: 3,
      matches: [{ visual_id: "v1", title: "Chart", facts: 3, facts_found: 3, missed: [] }],
      missed: { facts: [{ page: 0, channel: "image", fact: "Q3 = 12" }], visuals: [] },
    })
    expect(vi.mocked(querySnowflake).mock.calls[0][1]).toEqual({ binds: ["quarterly_report"] })
  })

  it("parses MATCHES and MISSED delivered as JSON strings; null becomes empty", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([
      row("AGENTIC", { MATCHES: '[{"visual_id":"v9"}]', MISSED: null }),
    ])
    const [c] = (await (await call("d")).json()).comparisons
    expect(c.matches).toEqual([{ visual_id: "v9" }])
    expect(c.missed).toEqual({ facts: [], visuals: [] })
  })

  it("returns an empty list when nothing is scored (uploaded Documents)", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([])
    expect(await (await call("upload_1")).json()).toEqual({ comparisons: [] })
  })

  it("returns 400 for an invalid id without querying", async () => {
    expect((await call("../x")).status).toBe(400)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
})
