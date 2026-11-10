import { describe, expect, it } from "vitest"
import { describeApp, withAppContext, type AppSnapshot } from "../../lib/app-context"

const viewer = {
  doc: "claim_packet", page: 2, pageCount: 6, view: "one" as const, mode: "LAYOUT", pair: "OCR",
  visuals: [{ visualId: "img-0.jpeg", imageType: "chart" }, { visualId: "img-1.jpeg", imageType: null }],
  openVisual: null, zoom: "fit width (100%)", missedOpen: false,
}
const doc: AppSnapshot = { route: "document", viewer, homeDocs: [], compareAnswers: true, theme: "light", spotlight: null }

describe("describeApp", () => {
  it("document route: 1-based page, view, tab, Visuals, zoom, panels, toggles", () => {
    const s = describeApp(doc)
    expect(s).toMatch(/^\[App state: route document\./)
    expect(s).toContain("Document claim_packet, page 3 of 6")
    expect(s).toContain("pages are 1-based; pass page 3 to control_app")
    expect(s).toContain("view one, mode tab LAYOUT")
    expect(s).toContain("img-0.jpeg (chart), img-1.jpeg (unknown)")
    expect(s).toContain("Open Visual detail: none")
    expect(s).toContain("Zoom: fit width (100%)")
    expect(s).toContain("What was missed: closed")
    expect(s).toContain("Compare answers across modes: on")
    expect(s).toContain("Theme: light")
    expect(s).toContain("Spotlight: none")
    expect(s).not.toContain("control_viewer")
  })
  it("compare view names the pair; open panels and spotlight show", () => {
    const s = describeApp({ ...doc, viewer: { ...viewer, view: "compare", openVisual: "img-0.jpeg", missedOpen: true }, theme: "dark", compareAnswers: false, spotlight: "tour step 2 of 5 on score_strip" })
    expect(s).toContain("view compare, AGENTIC vs OCR")
    expect(s).toContain("Open Visual detail: img-0.jpeg")
    expect(s).toContain("What was missed: open")
    expect(s).toContain("Compare answers across modes: off")
    expect(s).toContain("Theme: dark")
    expect(s).toContain("Spotlight: tour step 2 of 5 on score_strip")
  })
  it("home route lists the visible Documents", () => {
    const s = describeApp({ ...doc, route: "home", viewer: null, homeDocs: ["claim_packet", "receipt_photo"] })
    expect(s).toMatch(/^\[App state: route home/)
    expect(s).toContain("Documents listed: claim_packet, receipt_photo")
    expect(describeApp({ ...doc, route: "home", viewer: null })).toContain("Documents listed: none loaded")
  })
  it("prepends the line to the question only", () => {
    expect(withAppContext("where am I?", doc)).toMatch(/^\[App state:[^\n]*\]\n\nwhere am I\?$/)
  })
})
