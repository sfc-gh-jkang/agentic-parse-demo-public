import type { Target } from "@/lib/app-actions"

export const CARD_W = 340
const CARD_H = 190 // generous estimate; the card never needs to be measured
const GAP = 12
const EDGE = 12

/** First visible element tagged data-tour="<target>" (some targets repeat, e.g. run_button in Compare view). */
export function findTarget(target: Target, root: ParentNode = document): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    if (el.getClientRects().length > 0) return el
  }
  return null
}

export interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

/** The part of a target inside the viewport (below the sticky header); this is what gets ringed. */
export function visibleBox(r: Box, vw: number, vh: number, headerH = 0): Box {
  return { top: Math.max(r.top, headerH), bottom: Math.min(r.bottom, vh), left: Math.max(r.left, 0), right: Math.min(r.right, vw) }
}

/** True if a target is too tall to centre: it gets scrolled to its top and only its visible part is ringed. */
export const isTall = (height: number, vh: number) => height > 0.7 * vh

function overlap(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
}

/**
 * Where the caption card goes, next to the (visible part of the) target and never over it: below, above,
 * right, then left. If nothing fits cleanly (target fills the screen), the on-screen spot covering least of it.
 */
export function placeCard(r: Box, vw: number, vh: number, headerH = 0): { left: number; top: number } {
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, vw - CARD_W - EDGE))
  const clampY = (y: number) => Math.max(headerH + EDGE, Math.min(y, vh - CARD_H - EDGE))
  const midY = clampY((r.top + r.bottom) / 2 - CARD_H / 2)
  const cands = [
    { left: clampX(r.left), top: r.bottom + GAP },
    { left: clampX(r.left), top: r.top - GAP - CARD_H },
    { left: r.right + GAP, top: midY },
    { left: r.left - GAP - CARD_W, top: midY },
  ]
  const fits = (c: { left: number; top: number }) =>
    c.left >= EDGE && c.left + CARD_W <= vw - EDGE && c.top >= headerH + EDGE && c.top + CARD_H <= vh - EDGE
  const box = (c: { left: number; top: number }) => ({ top: c.top, bottom: c.top + CARD_H, left: c.left, right: c.left + CARD_W })
  const clean = cands.find((c) => fits(c) && overlap(box(c), r) === 0)
  if (clean) return clean
  const corners = [
    { left: vw - CARD_W - EDGE, top: vh - CARD_H - EDGE },
    { left: EDGE, top: vh - CARD_H - EDGE },
    { left: vw - CARD_W - EDGE, top: headerH + EDGE },
    { left: EDGE, top: headerH + EDGE },
  ]
  return [...cands.filter(fits), ...corners].sort((a, b) => overlap(box(a), r) - overlap(box(b), r))[0]
}
