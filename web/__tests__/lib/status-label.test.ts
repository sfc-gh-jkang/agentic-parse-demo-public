import { describe, expect, it } from "vitest"
import { emptyTurn, reduceAgentEvent, statusLabel } from "@/lib/agent-stream"

const ev = (event: string, data: object) => ({ event, data })

describe("statusLabel", () => {
  it("follows the agent: planning, tool, writing", () => {
    let t = emptyTurn()
    expect(statusLabel(t)).toBe("Thinking…")
    t = reduceAgentEvent(t, ev("response.status", { message: "Planning the next steps" }))
    expect(statusLabel(t)).toBe("Planning…")
    t = reduceAgentEvent(t, ev("response.tool_use", { name: "parsed_documents" }))
    expect(statusLabel(t)).toBe("Searching parsed pages…")
    t = reduceAgentEvent(t, ev("response.tool_use", { name: "mode_scores" }))
    expect(statusLabel(t)).toBe("Checking scores…")
    t = reduceAgentEvent(t, ev("response.tool_use", { name: "control_app" }))
    expect(statusLabel(t)).toBe("Moving the viewer…")
    t = reduceAgentEvent(t, ev("response.text.delta", { text: "Q3", content_index: 0 }))
    expect(statusLabel(t)).toBe("Writing the answer…")
  })
  it("names unknown tools generically", () => {
    expect(statusLabel(reduceAgentEvent(emptyTurn(), ev("response.tool_use", { name: "new_tool" })))).toBe("Using a tool…")
  })
})
