import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ModeScoreStrip } from "@/components/documents/mode-score-strip"

const noop = () => {}

describe("ModeScoreStrip", () => {
  it("shows a neutral placeholder while loading, never the upload note (corpus docs flashed it)", () => {
    const html = renderToStaticMarkup(
      <ModeScoreStrip loading modes={["AGENTIC", "LAYOUT"]} comparisons={[]} hasGroundTruth={false} missedOpen={false} onMissedToggle={noop} />,
    )
    expect(html).toContain("Loading scores")
    expect(html).not.toContain("no Ground Truth")
  })

  it("still says an upload has no Ground Truth once loaded", () => {
    const html = renderToStaticMarkup(
      <ModeScoreStrip modes={["AGENTIC"]} comparisons={[]} hasGroundTruth={false} missedOpen={false} onMissedToggle={noop} />,
    )
    expect(html).toContain("no Ground Truth")
  })
})
