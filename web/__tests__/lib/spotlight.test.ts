import { describe, expect, it } from "vitest"
import { CARD_W, placeCard, visibleBox, isTall } from "../../lib/spotlight"

const CARD_H = 190
const hits = (c: { left: number; top: number }, r: { top: number; bottom: number; left: number; right: number }) =>
  c.left < r.right && c.left + CARD_W > r.left && c.top < r.bottom && c.top + CARD_H > r.top

describe("placeCard", () => {
  it("goes below a target with room", () => expect(placeCard({ top: 100, bottom: 140, left: 50, right: 600 }, 1280, 800)).toEqual({ left: 50, top: 152 }))
  it("goes above a target near the bottom", () => expect(placeCard({ top: 700, bottom: 760, left: 50, right: 600 }, 1280, 800).top).toBe(700 - 12 - 190))
  it("goes beside a tall target and never covers it", () => {
    const r = { top: 70, bottom: 800, left: 0, right: 700 }
    const p = placeCard(r, 1280, 800, 56)
    expect(hits(p, r)).toBe(false)
    expect(p.left).toBeGreaterThanOrEqual(700)
  })
  it("does not overlap a wide score strip in the middle of the screen", () => {
    const r = { top: 300, bottom: 400, left: 20, right: 1260 }
    expect(hits(placeCard(r, 1280, 800, 56), r)).toBe(false)
  })
  it("stays on screen even when the target fills it", () => {
    const p = placeCard({ top: 0, bottom: 800, left: 0, right: 1280 }, 1280, 800)
    expect(p.left).toBeGreaterThanOrEqual(12)
    expect(p.top + CARD_H).toBeLessThanOrEqual(800)
  })
})

describe("visibleBox / isTall", () => {
  it("clips to the viewport below the header", () =>
    expect(visibleBox({ top: -300, bottom: 2000, left: 10, right: 900 }, 1280, 800, 56)).toEqual({ top: 56, bottom: 800, left: 10, right: 900 }))
  it("treats >70% of viewport as tall", () => {
    expect(isTall(600, 800)).toBe(true)
    expect(isTall(500, 800)).toBe(false)
  })
})
