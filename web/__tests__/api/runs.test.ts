import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn() }))

import { querySnowflake } from "../../lib/snowflake"
import { GET } from "../../app/api/documents/[id]/runs/route"

const call = (id: string) => GET(new Request("http://x/api"), { params: Promise.resolve({ id }) })
const row = (mode: string, runId: string, idx: number) => ({
  RUN_ID: runId, DOC_ID: "d", MODE: mode, FINISHED_AT: new Date("2026-10-30T13:00:00Z"),
  PAGE_INDEX: idx, CONTENT: `${mode} p${idx}`, PAGE_WIDTH: 1700, PAGE_HEIGHT: 2200,
})

describe("GET /api/documents/[id]/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("groups pages by mode in OCR, LAYOUT, AGENTIC order", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([
      row("AGENTIC", "r3", 0), row("LAYOUT", "r2", 0), row("LAYOUT", "r2", 1), row("OCR", "r1", 0),
    ])
    const json = await (await call("d")).json()
    expect(json.runs.map((r: any) => r.mode)).toEqual(["OCR", "LAYOUT", "AGENTIC"])
    const layout = json.runs[1]
    expect(layout).toMatchObject({ runId: "r2", finishedAt: "2026-10-30T13:00:00.000Z" })
    expect(layout.pages).toEqual([
      { index: 0, content: "LAYOUT p0", width: 1700, height: 2200 },
      { index: 1, content: "LAYOUT p1", width: 1700, height: 2200 },
    ])
    expect(vi.mocked(querySnowflake).mock.calls[0][1]).toEqual({ binds: ["d"] })
  })

  it("returns an empty list when nothing is parsed", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([])
    expect(await (await call("d")).json()).toEqual({ runs: [] })
  })

  it("returns 400 for an invalid id without querying", async () => {
    expect((await call("Bad Id")).status).toBe(400)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
})
