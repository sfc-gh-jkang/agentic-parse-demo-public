import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { HowIAnswered } from "@/components/agent/how-i-answered"

describe("HowIAnswered", () => {
  it("renders nothing without steps", () => {
    expect(renderToStaticMarkup(<HowIAnswered steps={[]} done />)).toBe("")
  })
  it("is a closed <details> with ordered plain-language lines and a call count", () => {
    const html = renderToStaticMarkup(
      <HowIAnswered done steps={[
        { kind: "thinking", text: "Need scores first.", index: 0 },
        { kind: "tool", id: "a", name: "parse_analytics", state: "done", detail: "recall by mode" },
        { kind: "tool", id: "b", name: "parsed_documents", state: "done", detail: "" },
      ]} />,
    )
    expect(html).toContain("<details")
    expect(html).not.toContain("open")
    expect(html).toContain("How I answered (2 tool calls)")
    expect(html.indexOf("Need scores first.")).toBeLessThan(html.indexOf("scores and counts"))
    expect(html.indexOf("scores and counts")).toBeLessThan(html.indexOf("Searched the parsed pages"))
  })
})

describe("HowIAnswered status lines", () => {
  it("hides repeated platform status lines when tool or thinking steps exist, shows them otherwise", () => {
    const withTool = renderToStaticMarkup(<HowIAnswered done steps={[
      { kind: "status", text: "Planning the next steps" },
      { kind: "tool", id: "a", name: "mode_scores", state: "done", detail: "" },
    ]} />)
    expect(withTool).not.toContain("Planning the next steps")
    const only = renderToStaticMarkup(<HowIAnswered done steps={[{ kind: "status", text: "Planning the next steps" }]} />)
    expect(only).toContain("Planning the next steps")
  })
})
