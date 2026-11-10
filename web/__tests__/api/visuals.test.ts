import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn() }))

import { querySnowflake } from "../../lib/snowflake"
import { GET } from "../../app/api/documents/[id]/visuals/route"

const call = (id: string) => GET(new Request("http://x/api"), { params: Promise.resolve({ id }) })
const row = (over: Record<string, unknown> = {}) => ({
  VISUAL_ID: "v1", PAGE_INDEX: 1, IMAGE_TYPE: "bar_chart", SUMMARY: "Revenue by quarter",
  VISIBLE_TEXT: "Q1 Q2", DETAILS: { series: [{ points: [{ label: "Q1", value: "10" }] }] }, FAILED: false,
  X0: 0.1, Y0: 0.2, X1: 0.6, Y1: 0.5, ...over,
})

describe("GET /api/documents/[id]/visuals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("returns the latest AGENTIC Visuals with normalized boxes, binding only the id", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([row()])
    const json = await (await call("quarterly_report")).json()
    expect(json.visuals).toEqual([{
      visualId: "v1", page: 1, imageType: "bar_chart", summary: "Revenue by quarter", visibleText: "Q1 Q2",
      details: { series: [{ points: [{ label: "Q1", value: "10" }] }] }, failed: false,
      x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.5,
    }])
    expect(vi.mocked(querySnowflake).mock.calls[0][1]).toEqual({ binds: ["quarterly_report"] })
  })

  it("parses DETAILS delivered as a JSON string and keeps null boxes for image files", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([
      row({ DETAILS: '{"title":"T"}', X0: null, Y0: null, X1: null, Y1: null }),
    ])
    const [v] = (await (await call("whiteboard_photo")).json()).visuals
    expect(v.details).toEqual({ title: "T" })
    expect([v.x0, v.y0, v.x1, v.y1]).toEqual([null, null, null, null])
  })

  it("flags failed Visuals and tolerates missing fields", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([
      row({ FAILED: true, IMAGE_TYPE: null, SUMMARY: null, VISIBLE_TEXT: null, DETAILS: null }),
    ])
    const [v] = (await (await call("d")).json()).visuals
    expect(v).toMatchObject({ failed: true, imageType: null, summary: "", visibleText: "", details: null })
  })

  it("returns an empty list when the Document has no Visuals", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([])
    expect(await (await call("receipt_photo")).json()).toEqual({ visuals: [] })
  })

  it("returns 400 for an invalid id without querying", async () => {
    expect((await call("Bad Id")).status).toBe(400)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
})
