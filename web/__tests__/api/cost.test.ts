import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn() }))

import { querySnowflake } from "../../lib/snowflake"
import { GET } from "../../app/api/cost/route"

describe("GET /api/cost", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("passes pending (null) cost through instead of inventing a number", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([
      { MODE: "AGENTIC", RUNS: 11, MEASURED_RUNS: 0, PENDING_RUNS: 11, PAGES_BILLED: null, CREDITS: null, CREDITS_PER_1K_PAGES: null, MEASURED_AT: new Date("2026-10-30T14:00:00Z") },
      { MODE: "LAYOUT", RUNS: 11, MEASURED_RUNS: 11, PENDING_RUNS: 0, PAGES_BILLED: 30, CREDITS: "0.09", CREDITS_PER_1K_PAGES: "3.0000", MEASURED_AT: new Date("2026-10-30T14:00:00Z") },
    ])
    const json = await (await GET()).json()
    expect(json.modes[0]).toMatchObject({ mode: "AGENTIC", pendingRuns: 11, creditsPer1kPages: null, measuredAt: "2026-10-30T14:00:00.000Z" })
    expect(json.modes[1]).toMatchObject({ mode: "LAYOUT", creditsPer1kPages: 3, measuredRuns: 11 })
    expect(vi.mocked(querySnowflake).mock.calls[0][0]).toContain("PARSE_COST(NULL)")
  })

  it("returns 500 on failure", async () => {
    vi.mocked(querySnowflake).mockRejectedValue(new Error("nope"))
    expect((await GET()).status).toBe(500)
  })
})
