import { describe, expect, it } from "vitest"
import { appToken, authHeaders, optionalAuthHeaders } from "../../e2e/token.mjs"

describe("e2e ingress token", () => {
  it("uses SNOWFLAKE_PAT directly and never reads a file", () => {
    const read = () => {
      throw new Error("must not read")
    }
    expect(appToken({ SNOWFLAKE_PAT: " pat123 " }, read, () => true)).toBe("pat123")
    expect(authHeaders({ SNOWFLAKE_PAT: "pat123" }, read, () => true)).toEqual({ Authorization: 'Snowflake Token="pat123"' })
  })
  it("falls back to the token file from app_token.py", () => {
    expect(appToken({ APP_TOKEN_FILE: "/t" }, () => "oauth\n", () => true)).toBe("oauth")
    expect(appToken({}, (f: string) => (f === "/tmp/.app_tok" ? "x" : ""), () => true)).toBe("x")
  })
  it("explains both options when neither exists", () => {
    expect(() => appToken({}, () => "", () => false)).toThrow(/SNOWFLAKE_PAT/)
    expect(() => appToken({}, () => " ", () => true)).toThrow(/empty/)
  })
  it("optional headers are empty without credentials", () => {
    expect(optionalAuthHeaders({})).toEqual({})
    expect(optionalAuthHeaders({ SNOWFLAKE_PAT: "p" })).toEqual({ Authorization: 'Snowflake Token="p"' })
  })
})
