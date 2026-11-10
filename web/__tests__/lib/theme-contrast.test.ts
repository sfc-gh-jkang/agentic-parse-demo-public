import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Round 7 axe-core: brand blue text/buttons were 2.4:1 and muted text 4.3:1. Keep the theme tokens at WCAG AA (4.5:1).
const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8")
const block = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf("}", css.indexOf(`${sel} {`)))
const token = (b: string, name: string): string => {
  const m = b.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6}|var\\(--[a-z-]+\\))`))
  if (!m) throw new Error(`missing --${name}`)
  return m[1].startsWith("var(") ? token(block(":root"), m[1].slice(6, -1)) : m[1]
}
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe("theme contrast", () => {
  const light = block(":root")
  const dark = block(".dark")
  const get = (b: string, n: string) => (b.includes(`--${n}:`) ? token(b, n) : token(light, n))
  it.each([
    ["light", light, "primary-foreground", "primary"],
    ["light", light, "primary", "background"],
    ["light", light, "primary", "card"],
    ["light", light, "muted-foreground", "muted"],
    ["light", light, "muted-foreground", "background"],
    ["dark", dark, "primary-foreground", "primary"],
    ["dark", dark, "primary", "background"],
    ["dark", dark, "muted-foreground", "muted"],
  ])("%s %s on %s >= 4.5", (_t, b, fg, bg) => {
    expect(ratio(get(b as string, fg as string), get(b as string, bg as string))).toBeGreaterThanOrEqual(4.5)
  })
})
