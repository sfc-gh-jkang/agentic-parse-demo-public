import { describe, expect, it } from "vitest"
import { clearClientState, STORAGE_PREFIX } from "@/lib/reset"
import { CHAT_KEY, COMPARE_KEY, loadChat, saveChat } from "@/lib/chat-history"

function store(init: Record<string, string>) {
  const m = new Map(Object.entries(init))
  return {
    m,
    get length() { return m.size },
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe("clearClientState", () => {
  it("removes only demo keys from session storage and forces the light theme", () => {
    const s = store({ [`${STORAGE_PREFIX}chat`]: "[]", [`${STORAGE_PREFIX}compare-results`]: "{}", [`${STORAGE_PREFIX}live-runs`]: "[]", other: "keep" })
    const l = store({ theme: "dark" })
    const removed = clearClientState(s, l)
    expect(removed.sort()).toEqual([`${STORAGE_PREFIX}chat`, `${STORAGE_PREFIX}compare-results`, `${STORAGE_PREFIX}live-runs`])
    expect([...s.m.keys()]).toEqual(["other"])
    expect(l.m.get("theme")).toBe("light")
  })

  it("clears the saved chat and its comparison tables (the real keys, not copies of their names)", () => {
    expect(CHAT_KEY.startsWith(STORAGE_PREFIX)).toBe(true)
    expect(COMPARE_KEY.startsWith(STORAGE_PREFIX)).toBe(true)
    const s = store({ [CHAT_KEY]: JSON.stringify([{ role: "user", text: "hi" }]), [COMPARE_KEY]: "{}" })
    expect(clearClientState(s, store({})).sort()).toEqual([CHAT_KEY, COMPARE_KEY].sort())
    expect(s.length).toBe(0)
  })
  it("leaves nothing for the chat to restore after a reset", () => {
    const m = new Map<string, string>()
    ;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    saveChat([{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }])
    expect(loadChat()).toHaveLength(2)
    const s = { get length() { return m.size }, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => void m.delete(k), setItem: () => {} }
    clearClientState(s, store({}))
    expect(loadChat()).toEqual([])
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage
  })
})
