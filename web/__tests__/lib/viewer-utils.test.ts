import { describe, expect, it } from "vitest"
import {
  previewKind,
  initialMode,
  visualPlaceholderLabel, toggleSelection, detailTopStyle,
  boxStyle, clampDividerPct, COMPARE_PAIRS, SPLIT_CLASSES, defaultDividerPct, formatScore, matchForVisual, modesForView, visualKey,
} from "../../lib/viewer-utils"

describe("boxStyle", () => {
  it("converts a normalized bbox to percentages", () => {
    expect(boxStyle({ x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.5 })).toEqual({ left: "10%", top: "20%", width: "50%", height: "30%" })
  })
  it("covers the whole image when the box is NULL (image files)", () => {
    expect(boxStyle({ x0: null, y0: null, x1: null, y1: null })).toEqual({ left: "0%", top: "0%", width: "100%", height: "100%" })
  })
  it("treats a partly missing box as whole-image rather than guessing", () => {
    expect(boxStyle({ x0: 0.1, y0: null, x1: 0.5, y1: 0.5 }).width).toBe("100%")
  })
  it("clamps out-of-range coordinates into the page", () => {
    expect(boxStyle({ x0: -0.1, y0: 0, x1: 1.2, y1: 1 })).toMatchObject({ left: "0%", width: "100%" })
  })
})

describe("modesForView", () => {
  it("shows the chosen single mode in One mode", () => {
    expect(modesForView("one", "LAYOUT", "LA")).toEqual(["LAYOUT"])
  })
  it("always puts AGENTIC on the left in Compare modes", () => {
    expect(modesForView("compare", "OCR", "LA")).toEqual(["AGENTIC", "LAYOUT"])
    expect(modesForView("compare", "OCR", "OA")).toEqual(["AGENTIC", "OCR"])
  })
  it("offers exactly AGENTIC vs LAYOUT (default) and AGENTIC vs OCR", () => {
    expect(COMPARE_PAIRS.map((p) => p.label)).toEqual(["AGENTIC vs LAYOUT", "AGENTIC vs OCR"])
    expect(COMPARE_PAIRS.every((p) => p.modes[0] === "AGENTIC")).toBe(true)
  })
})

describe("divider", () => {
  it("defaults to 65% in One mode and 40% in Compare modes", () => {
    expect(defaultDividerPct("one")).toBe(65)
    expect(defaultDividerPct("compare")).toBe(40)
  })
  it("clamps to 25-80%", () => {
    expect(clampDividerPct(10)).toBe(25)
    expect(clampDividerPct(95)).toBe(80)
    expect(clampDividerPct(50)).toBe(50)
  })
  it("falls back to null for a bad stored value", () => {
    expect(clampDividerPct(Number.NaN)).toBeNull()
  })
})

describe("matchForVisual", () => {
  const matches = [
    { visual_id: "img-0.jpeg", page: 0, title: "A", facts: 2, facts_found: 2, missed: [] },
    { visual_id: "img-0.jpeg", page: 1, title: "B", facts: 1, facts_found: 0, missed: ["x"] },
  ]
  it("finds the Ground Truth match by visual id and page (ids repeat across pages)", () => {
    expect(matchForVisual(matches, "img-0.jpeg", 1)?.title).toBe("B")
    expect(matchForVisual(matches, "img-0.jpeg", 0)?.title).toBe("A")
  })
  it("returns undefined for an unmatched Visual", () => {
    expect(matchForVisual(matches, "zzz", 0)).toBeUndefined()
  })
})

describe("visualKey", () => {
  it("is unique per page even when the visual id repeats", () => {
    expect(visualKey({ visualId: "img-0.jpeg", page: 0 })).not.toBe(visualKey({ visualId: "img-0.jpeg", page: 1 }))
  })
})

describe("formatScore", () => {
  it("renders found of expected", () => expect(formatScore(13, 13)).toBe("13/13"))
  it("renders n/a when there is nothing to score", () => expect(formatScore(null, null)).toBe("n/a"))
})

describe("visualPlaceholderLabel", () => {
  // AGENTIC markdown marks each Visual's position with ![img-0.jpeg](img-0.jpeg); the
  // viewer shows a labelled chip there instead of a broken image.
  const chart = { visualId: "img-0.jpeg", imageType: "chart", summary: "A bar chart.", details: { title: "Quarterly Revenue (USD millions)" } }

  it("names the Visual by type and title", () => {
    expect(visualPlaceholderLabel(chart)).toBe("Chart: Quarterly Revenue (USD millions)")
  })

  it("falls back to the summary when there is no title", () => {
    expect(visualPlaceholderLabel({ ...chart, details: {} })).toBe("Chart: A bar chart.")
  })

  it("humanizes multi-word image types and truncates long text", () => {
    const long = "x".repeat(200)
    const label = visualPlaceholderLabel({ visualId: "img-1.jpeg", imageType: "photo_with_text", summary: long, details: null })
    expect(label.startsWith("Photo with text: ")).toBe(true)
    expect(label.length).toBeLessThanOrEqual(80)
  })

  it("labels an image AGENTIC did not report by its id", () => {
    expect(visualPlaceholderLabel(undefined, "img-9.jpeg", "AGENTIC")).toBe("Image img-9.jpeg (not reported as a Visual)")
  })

  it("says plainly that text modes do not describe images", () => {
    // LAYOUT marks the same image positions but never describes them; never borrow AGENTIC's result.
    expect(visualPlaceholderLabel(undefined, "img-0.jpeg", "LAYOUT")).toBe("Image (LAYOUT does not describe images)")
  })
})

describe("detailTopStyle", () => {
  it("places the detail below the box with a gap", () => {
    expect(detailTopStyle({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6 })).toBe("calc(20% + 40% + 14px)")
  })
  it("falls back to under the whole page when the bbox is null", () => {
    expect(detailTopStyle({ x0: null, y0: null, x1: null, y1: null })).toBe("calc(0% + 100% + 14px)")
  })
})

describe("toggleSelection", () => {
  it("selects a Visual, and clicking the same one again closes it", () => {
    expect(toggleSelection(null, "0:img-0.jpeg")).toBe("0:img-0.jpeg")
    expect(toggleSelection("0:img-0.jpeg", "0:img-0.jpeg")).toBeNull()
  })
  it("switches straight to another Visual", () => {
    expect(toggleSelection("0:img-0.jpeg", "0:img-1.jpeg")).toBe("0:img-1.jpeg")
  })
})

describe("previewKind", () => {
  it("renders PDFs with pdf.js and PNG/JPG as images", () => {
    expect(previewKind("pdf")).toBe("pdf")
    expect(previewKind("PNG")).toBe("image")
    expect(previewKind("jpeg")).toBe("image")
  })
  it("has no browser preview for TIFF, PPTX and DOCX (QA F2)", () => {
    for (const t of ["tif", "tiff", "pptx", "docx"]) expect(previewKind(t)).toBe("none")
  })
})

describe("initialMode (QA F11)", () => {
  const pref = ["AGENTIC", "LAYOUT", "OCR"] as const
  it("prefers AGENTIC when it was parsed", () => expect(initialMode(["OCR", "AGENTIC"], pref)).toBe("AGENTIC"))
  it("falls back to LAYOUT, then OCR", () => {
    expect(initialMode(["OCR", "LAYOUT"], pref)).toBe("LAYOUT")
    expect(initialMode(["OCR"], pref)).toBe("OCR")
  })
  it("returns null with no runs", () => expect(initialMode([], pref)).toBeNull())
})

describe("groupMissed / agenticFirst", () => {
  it("groups visuals first then facts by page with counts", async () => {
    const { groupMissed } = await import("@/lib/viewer-utils")
    const g = groupMissed({ visuals: ["v1"], facts: [{ page: 1, channel: "image", fact: "b" }, { page: 0, channel: "text", fact: "a" }, { page: 1, channel: "image", fact: "c" }] })
    expect(g).toEqual([
      { label: "Visuals not detected", items: ["v1"] },
      { label: "Page 1", items: ["text: a"] },
      { label: "Page 2", items: ["image: b", "image: c"] },
    ])
  })
  it("puts AGENTIC leftmost", async () => {
    const { agenticFirst } = await import("@/lib/viewer-utils")
    expect(agenticFirst([{ mode: "OCR" }, { mode: "AGENTIC" }, { mode: "LAYOUT" }]).map((r) => r.mode)).toEqual(["AGENTIC", "OCR", "LAYOUT"])
  })
})

describe("SPLIT_CLASSES", () => {
  const has = (cls: string, token: string) => cls.split(/\s+/).includes(token)
  it("stacks viewer above parsed text below md and goes side by side from md", () => {
    expect(has(SPLIT_CLASSES.wrap, "flex-col")).toBe(true)
    expect(has(SPLIT_CLASSES.wrap, "md:flex-row")).toBe(true)
    expect(has(SPLIT_CLASSES.wrap, "flex-row")).toBe(false)
  })
  it("gives both panes full width on narrow screens and the divider width from md", () => {
    expect(has(SPLIT_CLASSES.viewer, "w-full")).toBe(true)
    expect(has(SPLIT_CLASSES.viewer, "md:w-[var(--split)]")).toBe(true)
    expect(has(SPLIT_CLASSES.text, "w-full")).toBe(true)
    expect(has(SPLIT_CLASSES.text, "md:flex-1")).toBe(true)
  })
  it("hides the drag divider below md", () => {
    expect(has(SPLIT_CLASSES.divider, "hidden")).toBe(true)
    expect(has(SPLIT_CLASSES.divider, "md:flex")).toBe(true)
  })
})
