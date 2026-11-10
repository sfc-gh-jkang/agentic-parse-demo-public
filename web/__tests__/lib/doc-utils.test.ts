import { describe, expect, it } from "vitest"
import { prettifyDocId } from "@/lib/doc-utils"

describe("prettifyDocId", () => {
  it("title-cases Corpus Document ids", () => {
    expect(prettifyDocId("quarterly_report")).toBe("Quarterly Report")
  })
  it("drops the up_ prefix and keeps the hex suffix apart for uploads (QA F4)", () => {
    expect(prettifyDocId("up_qa_all3_5c7887")).toBe("Qa All3 · 5c7887")
    expect(prettifyDocId("up_document_abcdef")).toBe("Document · abcdef")
  })
  it("leaves ids that only look like uploads alone", () => {
    expect(prettifyDocId("up_short")).toBe("Up Short")
  })
})
