import { describe, expect, it } from "vitest"
import { CHAT_KEY, COMPARE_KEY, agentHistory, clearChatStorage, parseChat, recentForAgent, serializeChat, type ChatMessage } from "@/lib/chat-history"
import { emptyTurn } from "@/lib/agent-stream"

describe("chat history survives a refresh (QA F8)", () => {
  it("round-trips finished messages", () => {
    const m: ChatMessage[] = [{ role: "user", text: "hi" }, { role: "assistant", text: "hello", turn: { ...emptyTurn(), text: "hello", done: true } }]
    expect(parseChat(serializeChat(m)).map((x) => x.text)).toEqual(["hi", "hello"])
  })
  it("drops an answer still streaming and its question", () => {
    const m: ChatMessage[] = [{ role: "user", text: "a" }, { role: "assistant", text: "b", turn: { ...emptyTurn(), done: true } },
      { role: "user", text: "c" }, { role: "assistant", text: "", turn: emptyTurn() }]
    expect(parseChat(serializeChat(m)).map((x) => x.text)).toEqual(["a", "b"])
  })
  it("ignores junk storage", () => {
    expect(parseChat("not json")).toEqual([])
    expect(parseChat('{"a":1}')).toEqual([])
    expect(parseChat('[{"role":"system","text":"x"},{"role":"user","text":"ok"}]')).toEqual([{ role: "user", text: "ok" }])
  })
})

describe("agent history skips failed turns (QA F12)", () => {
  it("drops a question whose answer errored, so the next answer does not reply to it", () => {
    const m: ChatMessage[] = [
      { role: "user", text: "a" }, { role: "assistant", text: "A", turn: { ...emptyTurn(), text: "A", done: true } },
      { role: "user", text: "b" }, { role: "assistant", text: "", turn: { ...emptyTurn(), error: "HTTP 503", done: true } },
      { role: "user", text: "c" },
    ]
    expect(agentHistory(m).map((x) => x.text)).toEqual(["a", "A", "c"])
  })
})

describe("recentForAgent (QA D2: a 20+ turn demo exceeded the 40-message API limit)", () => {
  const msgs = Array.from({ length: 50 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: `m${i}` }))
  it("keeps at most the newest 30, starting on a user message, ending on the newest", () => {
    const r = recentForAgent([...msgs, { role: "user", text: "last" }])
    expect(r.length).toBeLessThanOrEqual(30)
    expect(r[0].role).toBe("user")
    expect(r.at(-1)!.text).toBe("last")
  })
  it("clips long replies under the per-message limit", () => {
    const r = recentForAgent([{ role: "user", text: "q" }, { role: "assistant", text: "x".repeat(9000) }, { role: "user", text: "q2" }])
    expect(Math.max(...r.map((m) => m.text.length))).toBeLessThanOrEqual(3501)
  })
  it("leaves a short chat alone", () => expect(recentForAgent(msgs.slice(0, 3))).toEqual(msgs.slice(0, 3)))
})

describe("New chat storage", () => {
  it("removes the saved messages and comparison tables and nothing else", () => {
    const m = new Map([[CHAT_KEY, "[]"], [COMPARE_KEY, "{}"], ["agentic-parse-demo:live-runs", "[]"], ["theme", "dark"]])
    clearChatStorage({ removeItem: (k) => void m.delete(k) })
    expect([...m.keys()].sort()).toEqual(["agentic-parse-demo:live-runs", "theme"])
  })
})
