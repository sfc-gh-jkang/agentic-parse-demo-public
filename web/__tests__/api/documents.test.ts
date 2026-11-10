import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn() }))

import { querySnowflake } from "../../lib/snowflake"
import { GET } from "../../app/api/documents/route"

describe("GET /api/documents", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("returns the catalog with ISO timestamps and parsed Parse Modes", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([
      {
        DOC_ID: "quarterly_report",
        SOURCE: "corpus",
        FILE_TYPE: "pdf",
        STAGE_PATH: "corpus/quarterly_report.pdf",
        ADDED_AT: new Date("2026-10-30T12:00:00Z"),
        PAGES: 3,
        MODES_PARSED: '["AGENTIC","LAYOUT","OCR"]',
        LAST_PARSED_AT: new Date("2026-10-30T13:00:00Z"),
        HAS_GROUND_TRUTH: true,
      },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      documents: [
        {
          docId: "quarterly_report",
          source: "corpus",
          fileType: "pdf",
          addedAt: "2026-10-30T12:00:00.000Z",
          pages: 3,
          modesParsed: ["AGENTIC", "LAYOUT", "OCR"],
          lastParsedAt: "2026-10-30T13:00:00.000Z",
          hasGroundTruth: true,
        },
      ],
    })
  })

  it("handles a Document that was never parsed", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([
      { DOC_ID: "x", SOURCE: "upload", FILE_TYPE: "png", ADDED_AT: null, PAGES: null, MODES_PARSED: null, LAST_PARSED_AT: null, HAS_GROUND_TRUTH: false },
    ])
    const json = await (await GET()).json()
    expect(json.documents[0]).toMatchObject({ modesParsed: [], lastParsedAt: null, pages: null })
  })

  it("returns 500 with a generic message on failure, never Snowflake's text", async () => {
    vi.mocked(querySnowflake).mockRejectedValue(new Error("boom"))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain("boom")
  })
})
