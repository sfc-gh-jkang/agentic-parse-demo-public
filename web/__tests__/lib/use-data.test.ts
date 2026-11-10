import { describe, expect, it } from "vitest"
import { approxTokens, DOC_LINKS, renderSnippet, runnableSql, SNIPPETS, withSuffix } from "../../lib/use-data"

describe("use-data snippets", () => {
  it("renders the Document id and refuses a bad one", () => {
    expect(renderSnippet("WHERE DOC_ID = '{doc}'", "quarterly_report")).toBe("WHERE DOC_ID = 'quarterly_report'")
    for (const bad of ["x'; DROP TABLE t; --", "A", "", "a b", "a".repeat(65)]) expect(renderSnippet("{doc}", bad)).toBeNull()
  })
  it("allowlists read and billed snippets, never the pattern or an unknown id", () => {
    expect(runnableSql("pages", "claim_packet")?.sql).toContain("'claim_packet'")
    expect(runnableSql("ai_extract", "claim_packet")?.snippet.kind).toBe("billed")
    expect(runnableSql("dynamic_table", "claim_packet")).toBeNull()
    expect(runnableSql("DROP TABLE x", "claim_packet")).toBeNull()
    expect(runnableSql("pages", "bad doc")).toBeNull()
  })
  it("retargets VISUAL_DATA_POINTS to a scratch suffix and leaves the shown text alone", () => {
    expect(withSuffix("FROM A.B.VISUAL_DATA_POINTS", "_T21")).toBe("FROM A.B.VISUAL_DATA_POINTS_T21")
    expect(withSuffix("FROM A.B.VISUAL_DATA_POINTS", "")).toBe("FROM A.B.VISUAL_DATA_POINTS")
    expect(SNIPPETS.find((s) => s.id === "visual_rows")!.sql).not.toContain("_T21")
  })
  it("every snippet has a docs link from the allowed set and the pattern is labelled", () => {
    for (const s of SNIPPETS) expect(DOC_LINKS[s.doc_link]).toMatch(/^https:\/\/docs\.snowflake\.com\//)
    expect(SNIPPETS.find((s) => s.kind === "pattern")!.blurb).toContain("Pattern, not run here")
  })
  it("approxTokens is chars/4 rounded up", () => expect(approxTokens(1001)).toBe(251))
})
