import { describe, expect, it } from "vitest"
import { ACTIONS, TARGETS, applyViewerAction, parseAppAction, validateAppAction, viewerPart, type ViewerState } from "../../lib/app-actions"

const result = (r: unknown, extra: Record<string, unknown> = {}) => ({
  event: "response.tool_result",
  data: { name: "control_app", status: "success", content: [{ json: { result: typeof r === "string" ? r : JSON.stringify(r) } }], ...extra },
})
const base: ViewerState = { doc: "stamped_invoice", page: 0, view: "one", mode: "AGENTIC", pairKey: "LA", selectedKey: "0:img-0.jpeg", zoom: null, missedOpen: false }
const step = (target: string, caption = "c") => ({ target, caption })

describe("parseAppAction", () => {
  it("reads the procedure result string from a successful control_app tool_result", () => {
    expect(parseAppAction(result({ action: "open_document", doc: "claim_packet", page: 2, view: "compare", pair: "OCR" })))
      .toEqual({ action: "open_document", doc: "claim_packet", page: 2, view: "compare", pair: "OCR" })
  })
  it("ignores tool_use, other tools, errors, bad JSON and the retired control_viewer", () => {
    expect(parseAppAction({ event: "response.tool_use", data: { name: "control_app", input: { action: "go_home" } } })).toBeNull()
    expect(parseAppAction(result({ action: "go_home" }, { name: "mode_scores" }))).toBeNull()
    expect(parseAppAction(result({ action: "go_home" }, { name: "control_viewer" }))).toBeNull()
    expect(parseAppAction(result({ action: "go_home" }, { status: "error" }))).toBeNull()
    expect(parseAppAction(result({ error: "unknown doc: nope" }))).toBeNull()
    expect(parseAppAction(result("not json"))).toBeNull()
    expect(parseAppAction({ event: "response.text.delta", data: {} })).toBeNull()
  })
})

describe("validateAppAction: every action", () => {
  it.each([
    [{ action: "go_home" }],
    [{ action: "open_document", doc: "claim_packet" }],
    [{ action: "open_document", doc: "claim_packet", page: 3 }],
    [{ action: "set_page", page: 1 }],
    [{ action: "set_view", view: "compare" }],
    [{ action: "set_mode", mode: "LAYOUT" }],
    [{ action: "set_pair", pair: "OCR" }],
    [{ action: "select_visual", doc: "claim_packet", page: 3, visual: "img-0.jpeg" }],
    [{ action: "close_visual" }],
    [{ action: "zoom", zoom: "fit_width" }],
    [{ action: "zoom", zoom: "150" }],
    [{ action: "show_missed", missed: "open" }],
    [{ action: "open_upload" }],
    [{ action: "set_theme", theme: "dark" }],
    [{ action: "scroll", scroll: "parsed_text" }],
    [{ action: "highlight", target: "score_strip", caption: "Relations 27/27" }],
    [{ action: "clear_highlight" }],
    [{ action: "tour", steps: [step("page_buttons"), { ...step("visual_box"), doc: "claim_packet", page: 2 }, { ...step("upload_card"), route: "home" }] }],
    [{ action: "start_tour" }],
    [{ action: "open_value_panel" }],
    [{ action: "set_volume", volume: 50000 }],
    [{ action: "set_volume", volume: 50000, review_minutes: 5, hourly_rate: 60 }],
    [{ action: "set_review_assumptions", credit_price: 2.5 }],
    [{ action: "open_use_data_tab", doc: "quarterly_report" }],
  ])("accepts %j", (a) => expect(validateAppAction(a)).not.toBeNull())
  it("covers every action name", () => {
    const tested = ["go_home", "open_document", "set_page", "set_view", "set_mode", "set_pair", "select_visual", "close_visual", "zoom",
      "show_missed", "set_compare_answers", "open_upload", "set_theme", "scroll", "highlight", "clear_highlight", "tour", "start_tour",
      "open_value_panel", "set_volume", "set_review_assumptions", "open_use_data_tab"]
    expect([...ACTIONS].sort()).toEqual(tested.sort())
  })
  it("maps compare_answers on/off to a boolean", () => {
    expect(validateAppAction({ action: "set_compare_answers", compare_answers: "off" })).toEqual({ action: "set_compare_answers", compareAnswers: false })
    expect(validateAppAction({ action: "set_compare_answers", compare_answers: "on" })?.compareAnswers).toBe(true)
  })
  it("normalises zoom percents", () => expect(validateAppAction({ action: "zoom", zoom: "150%" })?.zoom).toBe(150))
})

describe("validateAppAction: combos", () => {
  it("keeps every optional field on one call", () => {
    expect(validateAppAction({ action: "open_document", doc: "claim_packet", page: 2, view: "compare", pair: "OCR", zoom: "200", missed: "open", target: "score_strip", caption: "Look here" }))
      .toEqual({ action: "open_document", doc: "claim_packet", page: 2, view: "compare", pair: "OCR", zoom: 200, missed: "open", target: "score_strip", caption: "Look here" })
  })
  it("theme and compare toggle ride along with navigation", () => {
    expect(validateAppAction({ action: "set_page", page: 2, theme: "light", compare_answers: "off" })).toEqual({ action: "set_page", page: 2, theme: "light", compareAnswers: false })
  })
})

describe("validateAppAction: invalid", () => {
  it.each([
    [{ action: "launch" }],
    [{ action: "open_document" }],
    [{ action: "open_document", doc: "Bad Doc" }],
    [{ action: "set_page" }],
    [{ action: "set_page", page: 0 }],
    [{ action: "set_page", page: 1.5 }],
    [{ action: "set_view", view: "grid" }],
    [{ action: "set_mode", mode: "FAST" }],
    [{ action: "set_mode" }],
    [{ action: "set_pair", pair: "AGENTIC" }],
    [{ action: "select_visual", visual: "img-0.jpeg" }],
    [{ action: "zoom" }],
    [{ action: "zoom", zoom: "301" }],
    [{ action: "zoom", zoom: "24" }],
    [{ action: "zoom", zoom: "huge" }],
    [{ action: "show_missed", missed: "maybe" }],
    [{ action: "set_compare_answers", compare_answers: "yes" }],
    [{ action: "set_theme", theme: "blue" }],
    [{ action: "scroll", scroll: "left" }],
    [{ action: "highlight", target: "score_strip" }],
    [{ action: "highlight", target: "nope", caption: "c" }],
    [{ action: "highlight", target: "score_strip", caption: "x".repeat(401) }],
    [{ action: "tour" }],
    [{ action: "tour", steps: [] }],
    [{ action: "tour", steps: Array.from({ length: 9 }, () => step("score_strip")) }],
    [{ action: "tour", steps: [step("nope")] }],
    [{ action: "tour", steps: [{ target: "score_strip" }] }],
    [{ action: "tour", steps: [{ ...step("score_strip"), page: 0 }] }],
    [{ action: "tour", steps: [{ ...step("score_strip"), route: "settings" }] }],
    [{ action: "go_home", doc: "claim_packet" }],
    [{ action: "open_upload", page: 2 }],
    [{ action: "set_volume" }],
    [{ action: "set_review_assumptions" }],
    [{ action: "set_review_assumptions", review_minutes: 0 }],
    [{ action: "set_review_assumptions", review_minutes: 601 }],
    [{ action: "set_review_assumptions", hourly_rate: -5 }],
    [{ action: "set_volume", volume: 0 }],
    [{ action: "set_volume", volume: 1.5 }],
    [{ action: "set_volume", volume: 2_000_000_000 }],
    [{ action: "open_use_data_tab" }],
    [{ error: "x" }],
    [null],
    ["go_home"],
  ])("rejects %j", (a) => expect(validateAppAction(a)).toBeNull())
})

describe("viewerPart", () => {
  it("open_use_data_tab selects the data tab of that Document", () => expect(viewerPart({ action: "open_use_data_tab", doc: "quarterly_report" })).toEqual({ doc: "quarterly_report", tab: "data" }))
  it("converts pages to 0-based", () => expect(viewerPart({ action: "open_document", doc: "a", page: 3 })).toEqual({ doc: "a", page: 2 }))
  it("a mode tab implies One mode; a pair implies Compare", () => {
    expect(viewerPart({ action: "set_mode", mode: "LAYOUT" })).toEqual({ mode: "LAYOUT", view: "one" })
    expect(viewerPart({ action: "set_pair", pair: "OCR" })).toEqual({ pair: "OCR", view: "compare" })
    expect(viewerPart({ action: "set_pair", pair: "OCR", view: "one" })?.view).toBe("one")
  })
  it("close_visual, zoom and What was missed", () => {
    expect(viewerPart({ action: "close_visual" })).toEqual({ closeVisual: true })
    expect(viewerPart({ action: "zoom", zoom: 150 })).toEqual({ zoom: 150 })
    expect(viewerPart({ action: "show_missed", missed: "close" })).toEqual({ missedOpen: false })
  })
  it("app-only actions have no viewer part", () => {
    for (const a of [{ action: "go_home" }, { action: "set_theme", theme: "dark" }, { action: "highlight", target: "score_strip", caption: "c" }, { action: "open_upload" }] as const)
      expect(viewerPart(a)).toBeNull()
  })
})

describe("applyViewerAction", () => {
  it("another Document resets page, selection and What was missed", () => {
    expect(applyViewerAction({ ...base, missedOpen: true }, { doc: "claim_packet" })).toMatchObject({ doc: "claim_packet", page: 0, selectedKey: null, missedOpen: false })
  })
  it("combines page, view, pair, mode, zoom and missed", () => {
    expect(applyViewerAction(base, { doc: "claim_packet", page: 1, view: "compare", pair: "OCR", zoom: 200, missedOpen: true }))
      .toMatchObject({ doc: "claim_packet", page: 1, view: "compare", pairKey: "OA", zoom: 200, missedOpen: true })
    expect(applyViewerAction(base, { mode: "OCR", view: "one" })).toMatchObject({ mode: "OCR", view: "one" })
  })
  it("a page change drops the selection; the same page keeps it", () => {
    expect(applyViewerAction(base, { page: 2 }).selectedKey).toBeNull()
    expect(applyViewerAction(base, { page: 0 }).selectedKey).toBe("0:img-0.jpeg")
  })
  it("selects a Visual on the target page and closes it", () => {
    expect(applyViewerAction(base, { doc: "stamped_invoice", page: 3, visual: "img-1.jpeg" })).toMatchObject({ page: 3, selectedKey: "3:img-1.jpeg" })
    expect(applyViewerAction(base, { closeVisual: true })).toEqual({ ...base, selectedKey: null })
  })
})

describe("TARGETS", () => {
  it("has no duplicates", () => expect(new Set(TARGETS).size).toBe(TARGETS.length))
})

describe("validateAppAction: agent-facing note", () => {
  it("drops the procedure's note and keeps the action", () => {
    expect(validateAppAction({ action: "set_theme", theme: "dark", note: "Only the demo web app applies this" })).toEqual({ action: "set_theme", theme: "dark" })
  })
})
