"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Maximize, MoveHorizontal, Search, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { boxStyle, detailTopStyle, visualKey } from "@/lib/viewer-utils"
import type { Visual } from "@/lib/doc-utils"
import type { ViewerZoom } from "@/lib/app-actions"

type Fit = "width" | "page" | number

const PAD = 16
const LENS = 180
const MAG = 2.5
const LENS_PDF_WIDTH = 3600
const MAX_CANVAS_PX = 8192
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const PAN_THRESHOLD_PX = 3

/**
 * One page of a Document (PDF via pdf.js, or an image) with zoom, pan, a magnifier lens,
 * and clickable boxes over the AGENTIC Visuals. Used for PDFs and image files alike.
 */
export function ZoomPage({
  url,
  isPdf,
  page,
  visuals,
  selectedVisualId,
  onSelectVisual,
  renderDetail,
  zoomRequest,
  onZoomChange,
}: {
  url: string
  isPdf: boolean
  page: number
  visuals: Visual[]
  selectedVisualId: string | null
  onSelectVisual: (visualId: string | null) => void
  /** Rendered directly under the selected Visual's box. */
  renderDetail?: (visual: Visual) => React.ReactNode
  /** A new object applies a zoom from the Demo Agent. */
  zoomRequest?: { value: ViewerZoom; id: number } | null
  /** Reports the zoom as text for the Demo Agent, e.g. "fit width (84%)" or "150%". */
  onZoomChange?: (label: string) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const pageDiv = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const lensCanvas = useRef<HTMLCanvasElement>(null)
  const detailEl = useRef<HTMLDivElement>(null)
  const lensSource = useRef<HTMLCanvasElement | null>(null)
  const pdfRef = useRef<{ url: string; doc: Promise<any> } | null>(null)
  const pending = useRef<{ fx: number; fy: number; px: number; py: number } | null>(null)

  const [fit, setFit] = useState<Fit>("width")
  const [box, setBox] = useState({ w: 600, h: 800 })
  const [aspect, setAspect] = useState(1.3) // height / width
  const [pdfPage, setPdfPage] = useState<any>(null)
  const [renderW, setRenderW] = useState(0)
  const [lensOn, setLensOn] = useState(false)
  const [lens, setLens] = useState<{ cx: number; cy: number; fx: number; fy: number } | null>(null)
  const [lensReady, setLensReady] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (selectedVisualId) detailEl.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [selectedVisualId])

  const cw = Math.max(100, box.w - PAD)
  const ch = Math.max(100, box.h - PAD)
  const z = fit === "width" ? 1 : fit === "page" ? Math.min(1, ch / (aspect * cw)) : fit
  const dw = Math.round(cw * z)
  const zoomLabel = fit === "width" ? `fit width (${Math.round(z * 100)}%)` : fit === "page" ? `fit page (${Math.round(z * 100)}%)` : `${Math.round(z * 100)}%`
  useEffect(() => onZoomChange?.(zoomLabel), [zoomLabel, onZoomChange])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Re-render the PDF page crisply once zoom settles.
  useEffect(() => {
    const t = setTimeout(() => setRenderW(dw), 150)
    return () => clearTimeout(t)
  }, [dw])

  useEffect(() => setFit("width"), [page])
  // Declared after the page reset so a zoom sent together with a page change wins.
  useEffect(() => {
    if (!zoomRequest) return
    const v = zoomRequest.value
    setFit(v === "fit_width" ? "width" : v === "fit_page" ? "page" : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v / 100)))
  }, [zoomRequest])

  useEffect(() => {
    if (!isPdf) return
    let cancelled = false
    setErr(null)
    ;(async () => {
      try {
        if (!pdfRef.current || pdfRef.current.url !== url) {
          // Loaded in the browser only: pdf.js touches DOM globals at import time.
          const pdfjs = await import("pdfjs-dist")
          // The worker is bundled from node_modules and served from our own origin (no CDN).
          pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
          pdfRef.current = { url, doc: pdfjs.getDocument({ url }).promise }
        }
        const doc = await pdfRef.current.doc
        const p = await doc.getPage(page + 1)
        if (cancelled) return
        const base = p.getViewport({ scale: 1 })
        setAspect(base.height / base.width)
        lensSource.current = null
        setPdfPage(p)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not render the PDF")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url, isPdf, page])

  // Render offscreen, then blit, so zooming never flashes a blank canvas.
  useEffect(() => {
    if (!pdfPage || !renderW || !canvas.current) return
    let task: any
    let cancelled = false
    ;(async () => {
      const base = pdfPage.getViewport({ scale: 1 })
      let w = renderW * (window.devicePixelRatio || 1)
      const ratio = base.height / base.width
      if (w > MAX_CANVAS_PX) w = MAX_CANVAS_PX
      if (w * ratio > MAX_CANVAS_PX) w = MAX_CANVAS_PX / ratio
      const vp = pdfPage.getViewport({ scale: w / base.width })
      const off = document.createElement("canvas")
      off.width = Math.floor(vp.width)
      off.height = Math.floor(vp.height)
      task = pdfPage.render({ canvas: off, viewport: vp })
      try {
        await task.promise
      } catch {
        return
      }
      if (cancelled || !canvas.current) return
      canvas.current.width = off.width
      canvas.current.height = off.height
      canvas.current.getContext("2d")!.drawImage(off, 0, 0)
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdfPage, renderW])

  // High-resolution copy for the lens, rendered only while the lens is on.
  useEffect(() => {
    if (!lensOn || !isPdf || !pdfPage || lensSource.current) return
    let task: any
    let cancelled = false
    const t = setTimeout(async () => {
      const base = pdfPage.getViewport({ scale: 1 })
      const vp = pdfPage.getViewport({ scale: LENS_PDF_WIDTH / base.width })
      const off = document.createElement("canvas")
      off.width = Math.floor(vp.width)
      off.height = Math.floor(vp.height)
      task = pdfPage.render({ canvas: off, viewport: vp })
      try {
        await task.promise
      } catch {
        return
      }
      if (cancelled) return
      lensSource.current = off
      setLensReady((n) => n + 1)
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
      task?.cancel()
    }
  }, [lensOn, isPdf, pdfPage])

  // Keep the double-clicked point under the cursor after the zoom lands.
  useLayoutEffect(() => {
    const p = pending.current
    const s = scroller.current
    const d = pageDiv.current
    if (!p || !s || !d) return
    s.scrollLeft = d.offsetLeft + p.fx * dw - p.px
    s.scrollTop = d.offsetTop + p.fy * (dw * aspect) - p.py
    pending.current = null
  }, [dw, aspect])

  useEffect(() => {
    const lc = lensCanvas.current
    if (!lens || !lc) return
    const src: CanvasImageSource | null = isPdf ? lensSource.current : img.current
    const dpr = window.devicePixelRatio || 1
    if (lc.width !== LENS * dpr) {
      lc.width = LENS * dpr
      lc.height = LENS * dpr
    }
    const g = lc.getContext("2d")!
    g.fillStyle = "#fff"
    g.fillRect(0, 0, lc.width, lc.height)
    if (!src) return
    const sw = isPdf ? (src as HTMLCanvasElement).width : (src as HTMLImageElement).naturalWidth
    const sh = isPdf ? (src as HTMLCanvasElement).height : (src as HTMLImageElement).naturalHeight
    if (!sw || !sh) return
    const region = (LENS / MAG / dw) * sw
    g.drawImage(src, lens.fx * sw - region / 2, lens.fy * sh - region / 2, region, region, 0, 0, lc.width, lc.height)
  }, [lens, lensReady, dw, isPdf])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "m" || e.key === "M") setLensOn((v) => !v)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!lensOn) setLens(null)
  }, [lensOn])

  const step = useCallback(
    (d: number) => setFit(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + d) * 4) / 4))),
    [z],
  )

  const onDouble = (e: React.MouseEvent) => {
    const d = pageDiv.current
    const s = scroller.current
    if (!d || !s) return
    if (fit !== "width" && z > 1.01) {
      setFit("width")
      return
    }
    const r = d.getBoundingClientRect()
    const sr = s.getBoundingClientRect()
    pending.current = {
      fx: (e.clientX - r.left) / r.width,
      fy: (e.clientY - r.top) / r.height,
      px: e.clientX - sr.left,
      py: e.clientY - sr.top,
    }
    setFit(2)
  }

  // Drag to pan. Starts only after a real drag so a double-click still reaches the page.
  const panning = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  const [grabbing, setGrabbing] = useState(false)
  const onPanDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = scroller.current
    if (!s || lensOn || e.button !== 0) return
    panning.current = { x: e.clientX, y: e.clientY, left: s.scrollLeft, top: s.scrollTop, moved: false }
  }
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = panning.current
    const s = scroller.current
    if (!p || !s) return
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < PAN_THRESHOLD_PX) return
      p.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
      setGrabbing(true)
    }
    s.scrollLeft = p.left - (e.clientX - p.x)
    s.scrollTop = p.top - (e.clientY - p.y)
  }
  const onPanUp = () => {
    panning.current = null
    setGrabbing(false)
  }

  const onMove = (e: React.MouseEvent) => {
    if (!lensOn) return
    const r = pageDiv.current!.getBoundingClientRect()
    setLens({ cx: e.clientX, cy: e.clientY, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height })
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border bg-muted/20">
      <div data-tour="zoom_controls" className="flex flex-wrap items-center gap-1 border-b bg-background px-2 py-1.5">
        <Button size="sm" variant={fit === "width" ? "default" : "outline"} onClick={() => setFit("width")} title="Fit width" aria-label="Fit width">
          <MoveHorizontal className="h-4 w-4" />
        </Button>
        <Button size="sm" variant={fit === "page" ? "default" : "outline"} onClick={() => setFit("page")} title="Fit page" aria-label="Fit page">
          <Maximize className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => step(-0.25)} disabled={z <= MIN_ZOOM} title="Zoom out" aria-label="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(z * 100)}%</span>
        <Button size="sm" variant="outline" onClick={() => step(0.25)} disabled={z >= MAX_ZOOM} title="Zoom in" aria-label="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button size="sm" variant={lensOn ? "default" : "outline"} onClick={() => setLensOn((v) => !v)} title="Magnifier (M)" aria-label="Magnifier" aria-pressed={lensOn}>
          <Search className="h-4 w-4" />
        </Button>
        <span className="ml-auto hidden text-xs text-muted-foreground xl:inline">Double-click to zoom · drag to pan</span>
      </div>
      <div
        ref={scroller}
        data-tour="document_page"
        onPointerDown={onPanDown}
        onPointerMove={onPanMove}
        onPointerUp={onPanUp}
        onPointerCancel={onPanUp}
        className={cn("relative min-h-0 flex-1 touch-none select-none overflow-auto p-2", !lensOn && (grabbing ? "cursor-grabbing" : "cursor-grab"))}
        style={{ scrollbarGutter: "stable" }}
      >
        {err ? (
          <p className="text-sm text-destructive">{err}</p>
        ) : (
          <div
            ref={pageDiv}
            onDoubleClick={onDouble}
            onMouseMove={onMove}
            onMouseLeave={() => setLens(null)}
            className={cn("relative mx-auto rounded-md border bg-white shadow-sm", lensOn && "cursor-none")}
            style={{ width: dw, height: isPdf ? dw * aspect : undefined }}
          >
            {isPdf ? (
              <canvas ref={canvas} className="block h-full w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={img}
                src={url}
                alt="Document"
                className="block h-auto w-full"
                onLoad={(e) => setAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
              />
            )}
            {visuals.map((v) => {
              const selected = visualKey(v) === selectedVisualId
              return (
                <button
                  key={visualKey(v)}
                  type="button"
                  data-tour="visual_box"
                  aria-label={`Visual: ${v.imageType ?? "unknown type"}${v.failed ? " (could not be read)" : ""}`}
                  aria-pressed={selected}
                  onClick={() => onSelectVisual(visualKey(v))}
                  className={cn(
                    "group absolute rounded-sm border-2 transition-colors",
                    v.failed ? "border-dashed border-red-500 bg-red-400/10" : "border-amber-400/70 bg-amber-300/10 hover:bg-amber-300/25",
                    selected && "border-amber-500 bg-amber-400/25 shadow-[0_0_0_3px_rgba(245,158,11,0.35)]",
                  )}
                  style={boxStyle(v)}
                >
                  <span className="pointer-events-none absolute left-0 top-0 z-10 hidden whitespace-nowrap rounded-br bg-amber-600 px-1.5 py-0.5 text-[11px] font-medium text-white group-hover:block">
                    {v.failed ? "could not read" : (v.imageType ?? "visual")}
                  </span>
                </button>
              )
            })}
            {renderDetail && (() => {
              const sv = visuals.find((v) => visualKey(v) === selectedVisualId)
              if (!sv) return null
              const st = boxStyle(sv)
              return (
                <div
                  ref={detailEl}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="absolute z-20 cursor-auto select-text"
                  style={{ left: 0, width: "100%", top: detailTopStyle(sv) }}
                >
                  <div className="absolute -top-2 h-4 w-4 rotate-45 border-l-2 border-t-2 border-amber-400 bg-background" style={{ left: `calc(${st.left} + ${st.width} / 2)` }} />
                  <div className="relative">{renderDetail(sv)}</div>
                </div>
              )
            })()}
          </div>
        )}
      </div>
      {lens && (
        <canvas
          ref={lensCanvas}
          className="pointer-events-none fixed z-50 rounded-full border-2 border-white shadow-xl ring-1 ring-black/30"
          style={{ width: LENS, height: LENS, left: lens.cx - LENS / 2, top: lens.cy - LENS / 2 }}
        />
      )}
    </div>
  )
}
