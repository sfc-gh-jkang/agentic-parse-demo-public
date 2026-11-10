import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { EvalResults, type EvalSummary } from "@/components/agent/eval-results"

const S: EvalSummary = {
  date: "2026-11-02", winner: "claude-sonnet-5-5", why: "Sonnet 31 vs Opus 30",
  models: [{ model: "claude-sonnet-5-5", passed: 31, total: 31, median_secs: 11.3 }],
  trajectory: [{ model: "claude-sonnet-5-5", id: "multi_step_headline", expected: ["parse_analytics", "mode_scores"], order: 1, calls: 5, redundant: 0 }],
}

describe("EvalResults", () => {
  it("shows date, model, pass count and the tool-order row", () => {
    const html = renderToStaticMarkup(<EvalResults summary={S} />)
    expect(html).toContain("run 2026-11-02")
    expect(html).toContain("31 / 31")
    expect(html).toContain("parse_analytics &gt; mode_scores")
    expect(html).toContain("1.00")
  })
})
