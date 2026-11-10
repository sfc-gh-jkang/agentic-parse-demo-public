import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/snowflake", () => ({ querySnowflake: vi.fn(), querySnowflakeLongRunning: vi.fn() }))

import { querySnowflake, querySnowflakeLongRunning } from "../../lib/snowflake"
import { POST as upload } from "../../app/api/upload/route"
import { POST as parse } from "../../app/api/documents/[id]/parse/route"

const form = (file: File | null) => {
  const fd = new FormData()
  if (file) fd.set("file", file)
  return new Request("http://x/api/upload", { method: "POST", body: fd })
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("rejects unsupported types before any query", async () => {
    const res = await upload(form(new File(["x"], "notes.txt")))
    expect(res.status).toBe(415)
    expect((await res.json()).error).toMatch(/Unsupported/)
    expect(querySnowflake).not.toHaveBeenCalled()
  })

  it("rejects files over 10 MB before any query", async () => {
    const res = await upload(form(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf")))
    expect(res.status).toBe(413)
    expect(querySnowflake).not.toHaveBeenCalled()
  })

  it("rejects an empty file as empty, not too large", async () => {
    const res = await upload(form(new File([], "empty.pdf")))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("The file is empty.")
    expect(querySnowflake).not.toHaveBeenCalled()
  })

  it("rejects a JSON body with 400, not 500", async () => {
    const res = await upload(new Request("http://x/api/upload", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("No file was sent.")
  })

  it("rejects a missing file", async () => {
    expect((await upload(form(null))).status).toBe(400)
  })

  it("passes filename and base64 content as binds and relays the result", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([{ UPLOAD_DOCUMENT: JSON.stringify({ ok: true, doc_id: "up_a_123456", pages: 1 }) }])
    const res = await upload(form(new File([new Uint8Array([1, 2, 3])], "a.pdf")))
    expect(await res.json()).toEqual({ ok: true, doc_id: "up_a_123456", pages: 1 })
    const [sql, opts] = vi.mocked(querySnowflake).mock.calls[0]
    expect(sql).toContain("CALL SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.UPLOAD_DOCUMENT(?, ?)")
    expect(opts?.binds).toEqual(["a.pdf", "AQID"])
  })

  it("relays a procedure rejection as 422 with its message", async () => {
    vi.mocked(querySnowflake).mockResolvedValue([{ UPLOAD_DOCUMENT: JSON.stringify({ ok: false, error: "Document has 21 pages; the limit is 20 pages." }) }])
    const res = await upload(form(new File(["x"], "a.pdf")))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/20 pages/)
  })
})

const parseReq = (body: unknown) =>
  new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })
const call = (id: string, body: unknown) => parse(parseReq(body), { params: Promise.resolve({ id }) })

describe("POST /api/documents/[id]/parse", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("validates id and mode before any query", async () => {
    expect((await call("Bad Id!", { mode: "OCR" })).status).toBe(400)
    expect((await call("doc", { mode: "BOGUS" })).status).toBe(400)
    expect((await call("doc", {})).status).toBe(400)
    expect(querySnowflakeLongRunning).not.toHaveBeenCalled()
  })

  it("calls APP_PARSE with binds and relays the result", async () => {
    vi.mocked(querySnowflakeLongRunning).mockResolvedValue([{ APP_PARSE: JSON.stringify({ ok: true, run_id: "r1", error: null, pages: 1 }) }])
    const res = await call("up_a_123456", { mode: "agentic" })
    expect(await res.json()).toEqual({ ok: true, run_id: "r1", error: null, pages: 1 })
    const [sql, opts] = vi.mocked(querySnowflakeLongRunning).mock.calls[0]
    expect(sql).toContain("CALL SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.APP_PARSE(?, ?)")
    expect(opts?.binds).toEqual(["up_a_123456", "AGENTIC"])
  })

  it("returns 500 when the procedure throws", async () => {
    vi.mocked(querySnowflakeLongRunning).mockRejectedValue(new Error("boom"))
    expect((await call("doc", { mode: "OCR" })).status).toBe(500)
  })
})
