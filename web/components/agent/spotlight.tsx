"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAgentActions, type Spotlight as SpotlightState } from "@/components/agent/agent-actions"
import { CARD_W, findTarget, isTall, placeCard, visibleBox } from "@/lib/spotlight"
import type { Target, TourStep } from "@/lib/app-actions"

const PAD = 6
const GIVE_UP_MS = 5000

/** Height of the sticky app header, which covers the top of the viewport. */
const headerH = () => document.querySelector("header.sticky")?.getBoundingClientRect().height ?? 0

function current(s: SpotlightState): { target: Target; caption: string } {
  return s.kind === "highlight" ? s : s.steps[s.index]
}

/**
 * Dims the page except one data-tour element, rings it and shows a caption card. Fixed-position overlay with
 * pointer-events off, so the layout never moves and the app stays usable. Esc or Close ends it.
 */
export function Spotlight({ onStep }: { onStep: (step: TourStep) => void }) {
  const { spotlight, setSpotlight } = useAgentActions()
  // The rect is stored with the step it was measured for, so a new step never shows the previous step's ring or card position.
  const [measured, setMeasured] = useState<{ key: string; rect: DOMRect } | null>(null)
  const [missing, setMissing] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const stepKey = spotlight ? `${spotlight.kind}:${current(spotlight).target}:${spotlight.kind === "tour" ? spotlight.index : current(spotlight).caption}` : ""
  // A tour step may first need another route, Document or page.
  useEffect(() => {
    if (spotlight?.kind === "tour") onStep(spotlight.steps[spotlight.index])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey])

  // Follow the target every frame: it may mount late (route change), scroll or resize.
  useEffect(() => {
    setMeasured(null)
    setMissing(false)
    if (!spotlight) return
    const { target } = current(spotlight)
    const focus = spotlight.kind === "highlight" && spotlight.focus
    const t0 = Date.now()
    let scrolled = false
    let raf = 0
    const tick = () => {
      const el = findTarget(target)
      if (el) {
        if (!scrolled) {
          scrolled = true
          // Centre it; a target too tall to centre goes to the top, just under the sticky header.
          if (isTall(el.getBoundingClientRect().height, window.innerHeight)) {
            el.scrollIntoView({ block: "start", inline: "nearest" })
            window.scrollBy(0, -(headerH() + PAD * 2))
          } else el.scrollIntoView({ block: "center", inline: "nearest" })
          if (focus) el.querySelector<HTMLElement>("button, input, [tabindex]")?.focus({ preventScroll: true })
        }
        const h = headerH()
        const b = visibleBox(el.getBoundingClientRect(), window.innerWidth, window.innerHeight, h)
        const r = new DOMRect(b.left, b.top, Math.max(0, b.right - b.left), Math.max(0, b.bottom - b.top))
        setMissing(false)
        setMeasured((p) => (p && p.key === stepKey && p.rect.top === r.top && p.rect.left === r.left && p.rect.width === r.width && p.rect.height === r.height ? p : { key: stepKey, rect: r }))
      } else if (Date.now() - t0 > GIVE_UP_MS) {
        setMissing(true)
        setMeasured(null)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey])

  useEffect(() => {
    if (!spotlight) return
    const h = (e: KeyboardEvent) => e.key === "Escape" && setSpotlight(null)
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [spotlight, setSpotlight])

  const rect = measured && measured.key === stepKey ? measured.rect : null
  // The card is portaled to the end of <body>, so a keyboard user would Tab through the whole page to reach Next.
  // Move focus to the step's primary button when a tour step's card appears (agent highlights keep focus where it is).
  const primary = useRef<HTMLButtonElement>(null)
  const cardShown = !!spotlight && mounted && (!!rect || missing)
  const isTour = spotlight?.kind === "tour"
  useEffect(() => {
    if (cardShown && isTour) primary.current?.focus({ preventScroll: true })
  }, [cardShown, isTour, stepKey])

  if (!spotlight || !mounted || (!rect && !missing)) return null
  const { target, caption } = current(spotlight)
  const tour = spotlight.kind === "tour" ? spotlight : null
  const go = (d: number) => tour && setSpotlight({ ...tour, index: tour.index + d })
  const pos = rect ? placeCard(rect, window.innerWidth, window.innerHeight, headerH()) : { left: (window.innerWidth - CARD_W) / 2, top: 96 }

  return createPortal(
    <>
      {rect ? (
        <div
          aria-hidden
          data-testid="spotlight-ring"
          className="pointer-events-none fixed z-[45] rounded-lg border-2 border-amber-400 ring-4 ring-amber-400/30 transition-all duration-200"
          style={{
            left: rect.left - PAD, top: rect.top - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45)",
          }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[45] bg-black/30" />
      )}
      <div
        role="dialog"
        aria-label={tour ? `Tour step ${tour.index + 1} of ${tour.steps.length}` : "Highlight"}
        data-testid="spotlight"
        data-target={target}
        data-step={tour ? tour.index + 1 : undefined}
        className="fixed z-[55] rounded-lg border border-amber-400 bg-popover p-3 text-sm text-popover-foreground shadow-xl"
        style={{ left: pos.left, top: pos.top, width: CARD_W }}
      >
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          {tour ? `Tour · ${tour.index + 1} of ${tour.steps.length}` : "Demo Agent"}
          <Button size="sm" variant="ghost" className="ml-auto h-6 w-6 p-0" onClick={() => setSpotlight(null)} aria-label="Close" data-testid="spotlight-close">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="leading-snug" data-testid="spotlight-caption">{caption}</p>
        {missing && <p className="mt-1 text-xs text-muted-foreground">(That part is not on this screen right now.)</p>}
        {tour && (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={tour.index === 0} onClick={() => go(-1)} data-testid="spotlight-back">Back</Button>
            {tour.index < tour.steps.length - 1 ? (
              <Button size="sm" className="ml-auto" ref={primary} onClick={() => go(1)} data-testid="spotlight-next">Next</Button>
            ) : (
              <Button size="sm" className="ml-auto" ref={primary} onClick={() => setSpotlight(null)} data-testid="spotlight-done">Done</Button>
            )}
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
