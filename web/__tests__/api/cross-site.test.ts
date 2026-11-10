import { describe, expect, it, vi } from "vitest"

const { querySnowflake, querySnowflakeLongRunning } = vi.hoisted(() => ({ querySnowflake: vi.fn(), querySnowflakeLongRunning: vi.fn() }))
vi.mock("../../lib/snowflake", () => ({ querySnowflake, querySnowflakeLongRunning, getSnowflakeBaseUrl: () => "http://sf", getServiceToken: () => "t", getRestApiAuthHeader: () => "Bearer t", readTomlDefaultConnection: () => null }))
const fetchSpy = vi.spyOn(globalThis, "fetch")

import { POST as parse } from "../../app/api/documents/[id]/parse/route"
import { POST as ask } from "../../app/api/ask/route"
import { POST as useData } from "../../app/api/use-data/run/route"
import { POST as agent } from "../../app/api/agent/route"
import { POST as upload } from "../../app/api/upload/route"
import { POST as reset } from "../../app/api/reset/route"

const params = { params: Promise.resolve({ id: "quarterly_report" }) }
const json = (body: unknown, extra: Record<string, string> = {}) =>
  new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) })
const plain = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) })
const msg = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }

// Every route that spends AI credits or changes state, with a body that would otherwise be accepted.
const routes: [string, (r: Request) => Promise<Response>, unknown][] = [
  ["parse", (r) => parse(r, params), { mode: "AGENTIC" }],
  ["ask", ask, { doc: "quarterly_report", question: "q" }],
  ["use-data", useData, { snippet: "ai_extract", doc: "quarterly_report", confirm: true }],
  ["agent", agent, msg],
  ["reset", reset, {}],
]

describe("billed and state-changing routes refuse requests another site could forge", () => {
  it.each(routes)("%s: 403 on Sec-Fetch-Site: cross-site, nothing runs", async (_n, call, body) => {
    expect((await call(json(body, { "Sec-Fetch-Site": "cross-site" }))).status).toBe(403)
    expect(querySnowflake).not.toHaveBeenCalled()
    expect(querySnowflakeLongRunning).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it.each(routes)("%s: 415 on a text/plain body (what an HTML form can send), nothing runs", async (_n, call, body) => {
    expect((await call(plain(body))).status).toBe(415)
    expect(querySnowflake).not.toHaveBeenCalled()
    expect(querySnowflakeLongRunning).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it("upload: 403 on a cross-site multipart form, nothing stored", async () => {
    const fd = new FormData()
    fd.append("file", new File([new Uint8Array([1])], "a.png"))
    const r = new Request("http://x/api/upload", { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "cross-site" } })
    expect((await upload(r)).status).toBe(403)
    expect(querySnowflake).not.toHaveBeenCalled()
  })
})
