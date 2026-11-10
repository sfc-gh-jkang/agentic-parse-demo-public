import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../lib/snowflake", () => ({ getSnowflakeBaseUrl: () => "https://acct.example", getRestApiAuthHeader: () => "Bearer t", getServiceToken: () => "t", readTomlDefaultConnection: () => null }))

import { POST } from "../../app/api/agent/route"
import { validateMessages } from "../../lib/agent-request"

const msg = (role: string, text: string) => ({ role, content: [{ type: "text", text }] })
const req = (body: unknown) => new Request("http://x/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

describe("validateMessages", () => {
  it("rejects an empty or whitespace-only last user message", () => {
    expect(validateMessages({ messages: [msg("user", "")] })).toBeNull()
    expect(validateMessages({ messages: [msg("user", "  \n\t ")] })).toBeNull()
  })

  it("accepts history ending in a user message", () => {
    expect(validateMessages({ messages: [msg("user", "a"), msg("assistant", "b"), msg("user", "c")] })).toHaveLength(3)
  })
  it.each([[null], [{ messages: [] }], [{ messages: [msg("assistant", "x")] }], [{ messages: [msg("system", "x")] }], [{ messages: [msg("user", "x".repeat(4001))] }]])("rejects %j", (b) => {
    expect(validateMessages(b)).toBeNull()
  })
})

describe("POST /api/agent", () => {
  beforeEach(() => vi.restoreAllMocks())
  it("400s on a bad body", async () => {
    expect((await POST(req({ messages: [] }))).status).toBe(400)
  })
  it("streams the upstream SSE through with OAUTH headers", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("event: response\ndata: {}\n\n", { status: 200 }))
    const res = await POST(req({ messages: [msg("user", "hi")] }))
    expect(res.headers.get("content-type")).toBe("text/event-stream")
    expect(await res.text()).toContain("event: response")
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://acct.example/api/v2/databases/SNOWFLAKE_EXAMPLE/schemas/AGENTIC_PARSE_DEMO/agents/AGENTIC_PARSE_DEMO_AGENT:run")
    expect((init.headers as Record<string, string>)["X-Snowflake-Authorization-Token-Type"]).toBe("OAUTH")
    expect(JSON.parse(init.body as string).stream).toBe(true)
  })
  it("turns an upstream failure into an SSE error frame", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("denied", { status: 403 }))
    const text = await (await POST(req({ messages: [msg("user", "hi")] }))).text()
    expect(text).toContain("event: error")
    expect(text).toContain("403")
  })
})
