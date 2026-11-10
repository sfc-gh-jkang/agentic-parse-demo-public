import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "fs"
import path from "path"
import { TARGETS } from "../../lib/app-actions"

const ROOT = path.resolve(__dirname, "../..")
const REPO = path.resolve(ROOT, "..")

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}
const code = ["app", "components"].flatMap((d) => sources(path.join(ROOT, d))).map((f) => readFileSync(f, "utf8")).join("\n")
// data-tour="x" on an element, or tour="x" passed to Segmented (which renders data-tour={tour}).
const tagged = new Set([...code.matchAll(/(?:data-tour|\btour)="([a-z_]+)"/g)].map((m) => m[1]))

describe("spotlight target catalog", () => {
  it.each([...TARGETS])("%s has a data-tour element in the app", (t) => expect(tagged.has(t)).toBe(true))
  it("tags no element outside the catalog", () => expect([...tagged].filter((t) => !(TARGETS as readonly string[]).includes(t))).toEqual([]))
  it("matches CONTROL_APP's TARGETS in sql/09_agent_tools.sql", () => {
    const sql = readFileSync(path.join(REPO, "sql/09_agent_tools.sql"), "utf8")
    const block = sql.match(/targets ARRAY DEFAULT ARRAY_CONSTRUCT\(([\s\S]*?)\);/)![1]
    expect([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...TARGETS].sort())
  })
  it.each([...TARGETS])("%s is explained in docs/app-guide.md", (t) => {
    expect(readFileSync(path.join(REPO, "docs/app-guide.md"), "utf8")).toMatch(new RegExp(`^###? ${t}:`, "m"))
  })
})
