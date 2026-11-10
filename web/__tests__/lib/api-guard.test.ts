import { describe, expect, it, vi } from "vitest"
import { errorResponse, rejectCrossSite, requireJson } from "../../lib/api-utils"

const req = (headers: Record<string, string>) => new Request("http://x/api/y", { method: "POST", body: "{}", headers })

describe("rejectCrossSite", () => {
  it.each([["cross-site"], ["same-site"]])("403s when the browser reports Sec-Fetch-Site: %s", async (v) => {
    const res = rejectCrossSite(req({ "Sec-Fetch-Site": v }))
    expect(res?.status).toBe(403)
  })
  it.each([["same-origin"], ["none"]])("allows Sec-Fetch-Site: %s", (v) => {
    expect(rejectCrossSite(req({ "Sec-Fetch-Site": v }))).toBeNull()
  })
  it("allows non-browser clients that send no Sec-Fetch-Site (scripts with a token)", () => {
    expect(rejectCrossSite(req({}))).toBeNull()
  })
})

describe("requireJson", () => {
  it.each([["text/plain"], ["application/x-www-form-urlencoded"], ["multipart/form-data; boundary=x"]])("415s on %s", (t) => {
    expect(requireJson(req({ "Content-Type": t }))?.status).toBe(415)
  })
  it("415s with no content type", () => expect(requireJson(req({}))?.status).toBe(415))
  it("allows application/json with a charset", () => expect(requireJson(req({ "Content-Type": "application/json; charset=utf-8" }))).toBeNull())
})

describe("errorResponse", () => {
  it("does not send the raw Snowflake error to the client (object names, SQL, query ids)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = errorResponse(new Error("SQL compilation error: Object 'SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.X' does not exist or not authorized."), "Failed to load")
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Failed to load" })
  })
})
