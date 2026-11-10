import { describe, expect, it } from "vitest"
import { TARGETS } from "../../lib/app-actions"
import { clearClientState } from "../../lib/reset"
import { TOUR_STEPS, WELCOME_KEY, hasSeenWelcome, markWelcomeSeen, type KV } from "../../lib/onboarding"

const store = (init: Record<string, string> = {}): KV & { data: Record<string, string> } => {
  const data = { ...init }
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) }
}

describe("onboarding tour steps", () => {
  it("walks the storyline order", () => {
    expect(TOUR_STEPS.map((s) => s.target)).toEqual([
      "cost_stats", "document_list", "score_strip", "visual_box", "visual_detail", "compare_pair_tabs",
      "chat_panel", "presenter_questions", "eval_button", "value_panel", "use_data_tab", "upload_card",
    ])
  })
  it("uses only known targets and plain, short captions", () => {
    for (const s of TOUR_STEPS) {
      expect(TARGETS as readonly string[]).toContain(s.target)
      expect(s.caption.length).toBeGreaterThan(20)
      expect(s.caption.length).toBeLessThanOrEqual(400)
    }
  })
  it("moves itself: home first, then quarterly_report page 1, then home again for upload", () => {
    expect(TOUR_STEPS[0].route).toBe("home")
    expect(TOUR_STEPS[2]).toMatchObject({ doc: "quarterly_report", page: 1, view: "one", mode: "AGENTIC" })
    expect(TOUR_STEPS[5].view).toBe("compare")
    expect(TOUR_STEPS[6].ui).toBe("chat_open")
    expect(TOUR_STEPS.at(-1)?.route).toBe("home")
  })
  it("never asks for anything billed", () => {
    expect(JSON.stringify(TOUR_STEPS)).not.toMatch(/reparse|re-parse now|run_button/i)
  })
})

describe("welcome flag", () => {
  it("is unseen on a fresh browser and seen after dismissal", () => {
    const s = store()
    expect(hasSeenWelcome(s)).toBe(false)
    markWelcomeSeen(s)
    expect(hasSeenWelcome(s)).toBe(true)
    expect(s.data[WELCOME_KEY]).toBe("1")
  })
  it("treats a blocked storage as seen, so the dialog cannot loop", () => {
    const blocked: KV = { getItem: () => { throw new Error("denied") }, setItem: () => { throw new Error("denied") } }
    expect(hasSeenWelcome(blocked)).toBe(true)
    expect(() => markWelcomeSeen(blocked)).not.toThrow()
  })
  it("survives the presenter reset, so Reset demo does not bring the welcome back", () => {
    const keys = [WELCOME_KEY]
    const session = { length: 0, key: () => null, removeItem: () => {}, setItem: () => {} }
    const local = { length: 1, key: (i: number) => keys[i] ?? null, removeItem: (k: string) => void keys.splice(keys.indexOf(k), 1), setItem: () => {} }
    clearClientState(session, local)
    expect(keys).toEqual([WELCOME_KEY])
  })
})
