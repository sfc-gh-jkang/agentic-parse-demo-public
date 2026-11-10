import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn() }))

import { querySnowflake } from "../../lib/snowflake"
import { GET } from "../../app/api/documents/[id]/file/route"
import { resetFileCache } from "../../lib/file-cache"

const call = (id: string, headers: Record<string, string> = {}) =>
  GET(new Request("http://x/api", { headers }), { params: Promise.resolve({ id }) })

const row = (text = "%PDF-1.7 hello", sha = "abc123") => [
  { CONTENT: Buffer.from(text), CONTENT_TYPE: "application/pdf", SHA256: sha },
]

describe("GET /api/documents/[id]/file", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetFileCache()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("returns bytes and content type from DOCUMENT_FILES with ETag and private cache header", async () => {
    vi.mocked(querySnowflake).mockResolvedValue(row())
    const res = await call("quarterly_report")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/pdf")
    expect(res.headers.get("cache-control")).toBe("private, max-age=300")
    expect(res.headers.get("etag")).toBe('"abc123"')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 hello")
    const [sql, opts] = vi.mocked(querySnowflake).mock.calls[0]
    expect(sql).toContain("DOCUMENT_FILES")
    expect(sql).not.toContain("GET_DOCUMENT_FILE")
    expect(opts).toEqual({ binds: ["quarterly_report"] })
  })

  it("returns 404 when there is no row", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([])
    expect((await call("nope")).status).toBe(404)
  })

  it("returns 400 for an invalid id without querying", async () => {
    for (const id of ["../etc", "Has Caps", "a'b", "x".repeat(65), ""]) {
      expect((await call(id)).status).toBe(400)
    }
    expect(querySnowflake).not.toHaveBeenCalled()
  })

  it("returns 304 when If-None-Match matches the sha256", async () => {
    vi.mocked(querySnowflake).mockResolvedValue(row())
    await call("quarterly_report")
    const res = await call("quarterly_report", { "if-none-match": '"abc123"' })
    expect(res.status).toBe(304)
    expect(res.headers.get("etag")).toBe('"abc123"')
  })

  it("serves a repeat request from the in-process cache", async () => {
    vi.mocked(querySnowflake).mockResolvedValue(row())
    await call("quarterly_report")
    const res = await call("quarterly_report")
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 hello")
    expect(querySnowflake).toHaveBeenCalledTimes(1)
  })

  it("returns 500 on query failure", async () => {
    vi.mocked(querySnowflake).mockRejectedValue(new Error("boom"))
    expect((await call("quarterly_report")).status).toBe(500)
  })
})
