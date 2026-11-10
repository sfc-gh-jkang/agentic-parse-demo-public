import { describe, expect, it } from "vitest"
import { checkUploadFile, resultLabel, MAX_UPLOAD_BYTES } from "../../lib/upload-utils"

describe("checkUploadFile", () => {
  it("accepts supported types under the limit, any case", () => {
    expect(checkUploadFile("a.PDF", 100)).toBeNull()
    expect(checkUploadFile("scan.tiff", MAX_UPLOAD_BYTES)).toBeNull()
  })
  it("rejects unsupported types with 415", () => {
    expect(checkUploadFile("a.txt", 1)?.status).toBe(415)
    expect(checkUploadFile("noext", 1)?.status).toBe(415)
  })
  it("rejects files over 10 MB with 413", () => {
    expect(checkUploadFile("a.pdf", MAX_UPLOAD_BYTES + 1)).toMatchObject({ status: 413 })
  })
})

describe("resultLabel", () => {
  it("is live only for run ids started in this session", () => {
    const live = new Set(["r1"])
    expect(resultLabel("r1", live)).toBe("live")
    expect(resultLabel("r2", live)).toBe("cached")
  })
})
