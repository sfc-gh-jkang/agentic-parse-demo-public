import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { renderToStaticMarkup } from "react-dom/server"
import summary from "../../lib/eval-summary.json"
import { EvalResults, type EvalSummary } from "../../components/agent/eval-results"

const md = readFileSync(path.resolve(__dirname, "../../../docs/model-eval.md"), "utf8")
const S = summary as EvalSummary

describe("the eval dialog agrees with docs/model-eval.md", () => {
  const total = md.match(/^\| \*\*total\*\* \|[^|]*\| \*\*(\d+)\/(\d+)\*\* \| median ([\d.]+) \| \*\*(\d+)\/(\d+)\*\* \| median ([\d.]+) \|/m)
  it("has a total row to compare against", () => expect(total).not.toBeNull())
  it("shows the same pass counts and medians for both models", () => {
    const [, sp, st, sm, op, ot, om] = total!
    expect(S.models[0]).toMatchObject({ model: "claude-sonnet-5-5", passed: Number(sp), total: Number(st), median_secs: Number(sm) })
    expect(S.models[1]).toMatchObject({ model: "claude-opus-5-5", passed: Number(op), total: Number(ot), median_secs: Number(om) })
  })
  it("shows the same decision line and run date", () => {
    expect(md).toContain(`**Decision: \`${S.winner}\`** (${S.why})`)
    expect(md).toContain(`Run ${S.date} `)
  })
  it("renders the counts it was given, not others", () => {
    const html = renderToStaticMarkup(<EvalResults summary={S} />)
    for (const m of S.models) expect(html).toContain(`${m.passed} / ${m.total}`)
  })
  it("keeps the tool-order columns apart (padding on every header and cell)", () => {
    const html = renderToStaticMarkup(<EvalResults summary={S} />)
    expect(html).toMatch(/<th>Order<\/th><th>Calls<\/th><th>Repeats<\/th>/)
    expect(html).toContain("[&amp;_th]:pr-4")
    expect(html).toContain("[&amp;_td]:pr-4")
  })
})
