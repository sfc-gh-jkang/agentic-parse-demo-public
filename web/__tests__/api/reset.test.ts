import { beforeEach, describe, expect, it, vi } from "vitest"

const querySnowflake = vi.fn()
vi.mock("../../lib/snowflake", () => ({ querySnowflake: (q: string) => querySnowflake(q) }))

import { POST } from "../../app/api/reset/route"

const req = (type: string | null) =>
  new Request("http://x/api/reset", { method: "POST", body: "{}", headers: type ? { "Content-Type": type } : {} })

describe("POST /api/reset", () => {
  beforeEach(() => querySnowflake.mockReset())
  it.each([["text/plain"], ["application/x-www-form-urlencoded"], ["multipart/form-data; boundary=x"], [null]])("415s on %s without touching Snowflake", async (t) => {
    expect((await POST(req(t))).status).toBe(415)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
  it("resets on application/json: RESET_DEMO, then REMOVE, then stage refresh", async () => {
    querySnowflake.mockResolvedValueOnce([{ RESET_DEMO: '{"ok":true,"uploads_removed":2}' }]).mockResolvedValue([])
    const res = await POST(req("application/json"))
    expect(await res.json()).toEqual({ ok: true, uploadsRemoved: 2 })
    expect(querySnowflake.mock.calls.map((c) => String(c[0]).split(" ")[0])).toEqual(["CALL", "REMOVE", "ALTER"])
  })
})
