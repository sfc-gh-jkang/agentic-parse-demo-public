"use client"

import { PreviewBadge } from "@/components/preview-badge"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, GripVertical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-state"
import { ParsedText } from "@/components/documents/parsed-text"
import { Segmented } from "@/components/documents/segmented"
import { ZoomPage } from "@/components/documents/zoom-page"
import { VisualDetail } from "@/components/documents/visual-detail"
import { UseDataTab } from "@/components/documents/use-data-tab"
import { ModeScoreStrip } from "@/components/documents/mode-score-strip"
import { RunButton } from "@/components/documents/run-button"
import { LIVE_EVENT, loadLiveRunIds, resultLabel } from "@/lib/upload-utils"
import {
  fetchJson, prettifyDocId, PARSE_MODES,
  type DocumentSummary, type ModeComparison, type ModeRun, type ParseMode, type Visual,
} from "@/lib/doc-utils"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useAgentActions } from "@/components/agent/agent-actions"
import { applyViewerAction, type ViewerZoom } from "@/lib/app-actions"
import {
  toggleSelection, clampDividerPct, COMPARE_PAIRS, SPLIT_CLASSES, previewKind, initialMode, defaultDividerPct, modesForView, visualKey, type ViewKind,
} from "@/lib/viewer-utils"

const MODE_CAPTION: Record<ParseMode, string> = {
  OCR: "OCR: text only",
  LAYOUT: "LAYOUT: text, tables and structure",
  AGENTIC: "AGENTIC: also understands charts, diagrams and images",
}
// One mode lists AGENTIC first.
const ONE_MODE_ORDER: ParseMode[] = ["AGENTIC", "LAYOUT", "OCR"]
const storageKey = (view: ViewKind) => `agentic-parse-demo:document-width:${view}`

function ResultBadge({ finishedAt, live }: { finishedAt: string | null; live: boolean }) {
  if (live) return <Badge variant="success" data-tour="cached_label">Live Result</Badge>
  return (
    <Badge variant="secondary" title={finishedAt ?? undefined} data-tour="cached_label">
      Cached Result · {formatRelative(finishedAt)}
    </Badge>
  )
}

export function DocumentViewer({ docId }: { docId: string }) {
  const [page, setPage] = useState(0)
  const [view, setView] = useState<ViewKind>("one")
  const [mode, setMode] = useState<ParseMode>("AGENTIC")
  const [pairKey, setPairKey] = useState(COMPARE_PAIRS[0].key)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const toggleVisual = (key: string | null) => setSelectedKey((cur) => (key === null ? null : toggleSelection(cur, key)))
  const [zoomRequest, setZoomRequest] = useState<{ value: ViewerZoom; id: number } | null>(null)
  const [zoomLabel, setZoomLabel] = useState("fit width")
  const [missedOpen, setMissedOpen] = useState(false)
  const [docTab, setDocTab] = useState<"parsed" | "data">("parsed")
  const router = useRouter()
  const { pending, consume, setViewer } = useAgentActions()
  const [liveRunIds, setLiveRunIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    const load = () => setLiveRunIds(loadLiveRunIds())
    load()
    window.addEventListener(LIVE_EVENT, load)
    return () => window.removeEventListener(LIVE_EVENT, load)
  }, [])
  const [pct, setPct] = useState(defaultDividerPct("one"))
  const [height, setHeight] = useState(600)
  const wrap = useRef<HTMLDivElement>(null)
  const columns = useRef<(HTMLDivElement | null)[]>([])
  const syncing = useRef(false)

  const docs = useQuery({ queryKey: ["documents"], queryFn: () => fetchJson<{ documents: DocumentSummary[] }>("/api/documents") })
  const runs = useQuery({ queryKey: ["runs", docId], queryFn: () => fetchJson<{ runs: ModeRun[] }>(`/api/documents/${docId}/runs`) })
  const visuals = useQuery({ queryKey: ["visuals", docId], queryFn: () => fetchJson<{ visuals: Visual[] }>(`/api/documents/${docId}/visuals`) })
  const comparison = useQuery({
    queryKey: ["comparison", docId],
    queryFn: () => fetchJson<{ comparisons: ModeComparison[] }>(`/api/documents/${docId}/comparison`),
  })

  const doc = docs.data?.documents.find((d) => d.docId === docId)
  const fileUrl = `/api/documents/${docId}/file`
  const runByMode = (m: ParseMode) => runs.data?.runs.find((r) => r.mode === m)
  // Once per Document: an OCR-only upload should not open on an empty AGENTIC panel.
  const runModes = (runs.data?.runs ?? []).map((r) => r.mode).join(",")
  const modeChosen = useRef<string | null>(null)
  useEffect(() => {
    if (!runs.isSuccess || modeChosen.current === docId) return
    modeChosen.current = docId
    const m = initialMode(runModes.split(",") as ParseMode[], ["AGENTIC", "LAYOUT", "OCR"] as const)
    if (m) setMode(m)
  }, [runs.isSuccess, runModes, docId])
  const isLive = (m: ParseMode) => {
    const r = runByMode(m)
    return !!r && resultLabel(r.runId, liveRunIds) === "live"
  }
  const refreshLive = () => setLiveRunIds(loadLiveRunIds())
  const pageCount = Math.max(doc?.pages ?? 0, ...(runs.data?.runs.map((r) => r.pages.length) ?? [0]), 1)
  const pageText = (m: ParseMode) => runByMode(m)?.pages.find((p) => p.index === page)?.content ?? ""
  const pageVisuals = (visuals.data?.visuals ?? []).filter((v) => v.page === page)
  const comparisons = comparison.data?.comparisons ?? []
  const agentic = comparisons.find((c) => c.mode === "AGENTIC")
  const hasGroundTruth = doc?.hasGroundTruth ?? false
  // Until the Document and its comparisons load, don't claim it is an upload without Ground Truth.
  const scoresLoading = !doc || comparison.data === undefined
  const shownModes = modesForView(view, mode, pairKey)
  const stripModes: ParseMode[] = view === "one" ? [...PARSE_MODES].reverse() : shownModes

  // Tell the chat what is on screen, so "next page" or "show me the chart" need no Document name.
  const visualSig = pageVisuals.map((v) => `${v.visualId}|${v.imageType ?? ""}`).join(",")
  const docKnown = !!doc
  useEffect(() => {
    if (!docKnown) return setViewer(null)
    setViewer({
      doc: docId,
      page,
      pageCount,
      view,
      mode,
      pair: pairKey === "OA" ? "OCR" : "LAYOUT",
      visuals: visualSig ? visualSig.split(",").map((s) => ({ visualId: s.split("|")[0], imageType: s.split("|")[1] || null })) : [],
      openVisual: selectedKey ? selectedKey.slice(selectedKey.indexOf(":") + 1) : null,
      zoom: zoomLabel,
      missedOpen,
    })
  }, [setViewer, docKnown, docId, page, pageCount, view, mode, pairKey, visualSig, selectedKey, zoomLabel, missedOpen])
  useEffect(() => () => setViewer(null), [setViewer])

  // Each view remembers its own Document width.
  useEffect(() => {
    const stored = clampDividerPct(Number(localStorage.getItem(storageKey(view))))
    setPct(localStorage.getItem(storageKey(view)) === null || stored === null ? defaultDividerPct(view) : stored)
  }, [view])
  useEffect(() => setSelectedKey((k) => (k && k.startsWith(`${page}:`) ? k : null)), [page])
  useEffect(() => {
    setPage(0)
    setMissedOpen(false)
  }, [docId])
  // Demo Agent viewer actions: another Document means navigating first; the action stays queued until this viewer mounts for it.
  useEffect(() => {
    if (!pending) return
    if (pending.doc && pending.doc !== docId) {
      router.push(`/documents/${pending.doc}`)
      return
    }
    const n = applyViewerAction({ doc: docId, page, view, mode, pairKey, selectedKey, zoom: null, missedOpen }, pending)
    if (pending.tab) setDocTab(pending.tab)
    setPage(n.page)
    setView(n.view)
    setMode(n.mode)
    setMissedOpen(n.missedOpen)
    setPairKey(n.pairKey)
    setSelectedKey(n.selectedKey)
    if (n.zoom !== null) setZoomRequest({ value: n.zoom, id: Date.now() })
    consume()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, docId])
  useEffect(() => {
    if (!selectedKey) return
    const h = (e: KeyboardEvent) => e.key === "Escape" && setSelectedKey(null)
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [selectedKey])
  useEffect(() => {
    const size = () => wrap.current && setHeight(Math.max(420, window.innerHeight - wrap.current.getBoundingClientRect().top - 12))
    size()
    window.addEventListener("resize", size)
    return () => window.removeEventListener("resize", size)
  }, [doc, view])

  const pctFromEvent = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect()
    return clampDividerPct(((clientX - r.left) / r.width) * 100) ?? defaultDividerPct(view)
  }
  const saveWidth = (v: number) => {
    setPct(v)
    localStorage.setItem(storageKey(view), String(v))
  }
  const onDividerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setPct(pctFromEvent(ev.clientX))
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      saveWidth(pctFromEvent(ev.clientX))
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
  }

  const onColumnScroll = (i: number) => {
    if (syncing.current) return
    const src = columns.current[i]
    if (!src) return
    const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight)
    syncing.current = true
    columns.current.forEach((el, j) => {
      if (el && j !== i) el.scrollTop = ratio * (el.scrollHeight - el.clientHeight)
    })
    requestAnimationFrame(() => (syncing.current = false))
  }

  const modeBody = (m: ParseMode) =>
    runs.isPending ? (
      <Skeleton className="h-40 w-full" />
    ) : runs.isError ? (
      <EmptyState variant="error" title="Could not load Parse Runs" description={runs.error.message} />
    ) : !runByMode(m) ? (
      <EmptyState title={`No ${m} Parse Run`} description="This Document has not been parsed in this Parse Mode." />
    ) : (
      <ParsedText mode={m} content={pageText(m)} visuals={m === "AGENTIC" ? pageVisuals : []} selectedKey={selectedKey} onSelectVisual={toggleVisual} />
    )

  if (docs.isSuccess && !doc) {
    return (
      <div className="space-y-3">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All Documents
        </Link>
        <EmptyState title="Document not found" description={`No Document named ${docId}. Uploads that were cleaned up no longer exist.`} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All Documents
        </Link>
        <h1 className="text-xl font-semibold">{prettifyDocId(docId)}</h1>
        {doc && (
          <span className="text-sm text-muted-foreground">
            {doc.fileType.toUpperCase()} · {doc.pages ?? "?"} page{doc.pages === 1 ? "" : "s"}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Link href="/#value" className="text-sm text-primary hover:underline" data-testid="value-link">Value of AGENTIC</Link>
          <Segmented
            label="Tab"
            tour="doc_tabs"
            value={docTab}
            onChange={setDocTab}
            options={[{ value: "parsed", label: "Parsed document" }, { value: "data", label: "Use this data" }]}
          />
          {pageCount > 1 && (
            <div className="flex items-center gap-1" role="group" aria-label="Page" data-tour="page_buttons">
              <span className="mr-1 text-xs text-muted-foreground">Page</span>
              {Array.from({ length: pageCount }, (_, i) => (
                <Button key={i} size="sm" variant={i === page ? "default" : "outline"} onClick={() => setPage(i)}>
                  {i + 1}
                </Button>
              ))}
            </div>
          )}
          <Segmented
            label="View"
            tour="view_toggle"
            value={view}
            onChange={setView}
            options={[{ value: "one", label: "One mode" }, { value: "compare", label: "Compare modes" }]}
          />
        </div>
      </div>

      {docTab === "data" ? (
        <UseDataTab docId={docId} />
      ) : (
        <>
      <ModeScoreStrip loading={scoresLoading} modes={stripModes} comparisons={comparisons} hasGroundTruth={hasGroundTruth} missedOpen={missedOpen} onMissedToggle={setMissedOpen} />
      {comparison.isError && <p className="text-xs text-destructive">Could not load Mode Comparison: {comparison.error.message}</p>}

      <p className="text-sm text-muted-foreground">
        {view === "compare"
          ? "The same page parsed by AGENTIC (left) and by LAYOUT or OCR (right). Scroll either column; the other follows. Amber boxes mark Visuals AGENTIC understood: click one for details."
          : "One Parse Mode at a time. Amber boxes mark Visuals AGENTIC understood: click one for details. Results labelled Cached Result were replayed from storage; Run re-parses a mode and shows a Live Result."}
      </p>

      <div ref={wrap} className={SPLIT_CLASSES.wrap} style={{ "--split-h": `${height}px` } as React.CSSProperties}>
        <div className={SPLIT_CLASSES.viewer} style={{ "--split": `${pct}%` } as React.CSSProperties}>
          {docs.isPending ? (
            <Skeleton className="h-full w-full" />
          ) : docs.isError ? (
            <EmptyState variant="error" title="Could not load the Document" description={docs.error.message} />
          ) : !doc ? (
            <EmptyState title="Document not found" description={`No Document named ${docId} in the Corpus.`} />
          ) : previewKind(doc.fileType) === "none" ? (
            <EmptyState
              title={`No browser preview for .${doc.fileType} files`}
              description="AI_PARSE_DOCUMENT read the file; its parsed text is on the right. Browsers cannot display this format, so there is no page image or Visual boxes."
            />
          ) : (
            <ZoomPage
              url={fileUrl}
              isPdf={previewKind(doc.fileType) === "pdf"}
              page={page}
              visuals={pageVisuals}
              selectedVisualId={selectedKey}
              zoomRequest={zoomRequest}
              onZoomChange={setZoomLabel}
              onSelectVisual={toggleVisual}
              renderDetail={(v) => (
                <VisualDetail visual={v} agentic={agentic} hasGroundTruth={hasGroundTruth} onClose={() => setSelectedKey(null)} />
              )}
            />
          )}
        </div>
        <div
          onPointerDown={onDividerDown}
          onDoubleClick={() => saveWidth(defaultDividerPct(view))}
          title="Drag to resize · double-click to reset"
          className={SPLIT_CLASSES.divider}
        >
          <div className="flex h-12 w-3 items-center justify-center rounded bg-muted text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground">
            <GripVertical className="h-4 w-4" />
          </div>
        </div>

        <div className={SPLIT_CLASSES.text}>
          {view === "one" ? (
            <>
              <Segmented
                label="Parse Mode"
                tour="mode_tabs"
                value={mode}
                onChange={setMode}
                options={ONE_MODE_ORDER.map((m) => ({ value: m, label: m }))}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {MODE_CAPTION[mode]}
                <RunButton docId={docId} mode={mode} onDone={refreshLive} />
                {runByMode(mode) && <ResultBadge finishedAt={runByMode(mode)!.finishedAt} live={isLive(mode)} />}
              </div>
              <div data-tour="parsed_text" className="min-h-0 flex-1 overflow-auto rounded-lg border p-3">{modeBody(mode)}</div>
            </>
          ) : (
            <>
              <Segmented
                label="Compare"
                tour="compare_pair_tabs"
                value={pairKey}
                onChange={setPairKey}
                options={COMPARE_PAIRS.map((p) => ({ value: p.key, label: p.label }))}
              />
              <div><PreviewBadge /></div>
              <div data-tour="parsed_text" className="grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                {shownModes.map((m, i) => (
                  <div
                    key={m}
                    className={cn("flex min-h-0 min-w-0 flex-col rounded-lg border", m === "AGENTIC" && "border-amber-400 ring-1 ring-amber-300")}
                  >
                    <div className={cn("border-b px-3 py-2", m === "AGENTIC" ? "bg-amber-50 dark:bg-amber-950/40" : "bg-muted/40")}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{m}</span>
                        <RunButton docId={docId} mode={m} onDone={refreshLive} />
                        {runByMode(m) && <ResultBadge finishedAt={runByMode(m)!.finishedAt} live={isLive(m)} />}
                      </div>
                      <div className="text-xs text-muted-foreground">{MODE_CAPTION[m]}</div>
                    </div>
                    <div ref={(el) => { columns.current[i] = el }} onScroll={() => onColumnScroll(i)} tabIndex={0} aria-label={`${m} parse`} className="min-h-0 flex-1 overflow-auto p-3">
                      {modeBody(m)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  )
}
