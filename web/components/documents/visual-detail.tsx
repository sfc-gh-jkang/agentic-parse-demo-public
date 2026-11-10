"use client"

import { X } from "lucide-react"
import { matchForVisual } from "@/lib/viewer-utils"
import type { ModeComparison, Visual } from "@/lib/doc-utils"

function itemText(x: unknown): string {
  if (typeof x === "string") return x
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>
    if (o.from !== undefined && o.to !== undefined) return `${o.from} → ${o.to}${o.label ? ` (${o.label})` : ""}`
    if (o.label !== undefined) return `${o.label}${o.role ? `: ${o.role}` : ""}`
    return JSON.stringify(x)
  }
  return String(x)
}

function List({ title, items }: { title: string; items: unknown[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="mb-1 text-sm font-semibold">{title}</div>
      <ul className="list-disc space-y-0.5 pl-5">
        {items.map((it, i) => (
          <li key={i}>{itemText(it)}</li>
        ))}
      </ul>
    </div>
  )
}

function AgenticResult({ v }: { v: Visual }) {
  const d = v.details ?? {}
  const series: { name?: string; points?: { label: unknown; value: unknown }[] }[] = Array.isArray(d.series) ? d.series : []
  const hasSeries = series.some((s) => (s.points ?? []).length > 0)
  const keyValues: unknown[] = Array.isArray(d.key_values) ? d.key_values : []
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-foreground">
      <p>
        <span className="mr-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900">{v.imageType ?? "visual"}</span>
        {v.summary}
      </p>
      {hasSeries &&
        series.map((s, si) => (
          <div key={si}>
            {s.name && <div className="mb-1 text-sm font-semibold">{s.name}</div>}
            <table className="w-full border-collapse overflow-hidden rounded-md border text-[15px]">
              <thead>
                <tr className="bg-muted text-left text-sm font-semibold">
                  <th className="border-b px-3 py-1.5">Label</th>
                  <th className="border-b px-3 py-1.5 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {(s.points ?? []).map((p, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5">{String(p.label ?? "")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{String(p.value ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {!hasSeries && <List title="Key values" items={keyValues} />}
      <List title="Components" items={Array.isArray(d.components) ? d.components : []} />
      <List title="Connections" items={Array.isArray(d.connections) ? d.connections : []} />
      {typeof d.notes === "string" && d.notes && <p className="text-sm text-muted-foreground">{d.notes}</p>}
      {v.visibleText && <p className="text-sm text-muted-foreground">Text in image: {v.visibleText}</p>}
    </div>
  )
}

function GroundTruthResult({ v, agentic, hasGroundTruth }: { v: Visual; agentic: ModeComparison | undefined; hasGroundTruth: boolean }) {
  const note = (t: string) => <p className="text-[15px] text-muted-foreground">{t}</p>
  if (!hasGroundTruth || !agentic) return note("No Ground Truth for uploaded Documents.")
  if (v.failed) return note("Failed Visuals are not scored.")
  const m = matchForVisual(agentic.matches, v.visualId, v.page)
  if (!m) return note("This Visual is not matched to a Ground Truth Visual.")
  const total = m.facts ?? 0
  const found = m.facts_found ?? 0
  const missed = m.missed ?? []
  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-foreground">
      <div className="font-semibold">{m.title}</div>
      {missed.length === 0 ? (
        <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-900">
          ✓ {found}/{total} fields match
        </span>
      ) : (
        <>
          <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">✗ {missed.length} missed</span>
          <ul className="list-disc space-y-0.5 pl-5">
            {missed.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** Opens under the clicked Visual's box in the Document column; the right-hand column is never resized. */
export function VisualDetail({
  visual, agentic, hasGroundTruth, onClose,
}: {
  visual: Visual
  agentic: ModeComparison | undefined
  hasGroundTruth: boolean
  onClose: () => void
}) {
  const card = "rounded-lg border bg-background p-4 shadow-sm"
  return (
    <section aria-label="Visual detail" data-tour="visual_detail" className="rounded-lg border-2 border-amber-400 bg-background shadow-lg">
      <header className="flex items-center justify-between border-b border-amber-200 dark:border-amber-800 px-4 py-2">
        <h3 className="text-base font-semibold">Visual · {visual.imageType ?? "unknown"}</h3>
        <button type="button" onClick={onClose} aria-label="Close Visual detail" className="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900/40">
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className={card}>
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">AGENTIC read</h4>
          {visual.failed ? <p className="text-[15px] font-semibold text-red-700 dark:text-red-400">AGENTIC could not read this Visual.</p> : <AgenticResult v={visual} />}
        </div>
        <div className={card}>
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ground Truth</h4>
          <GroundTruthResult v={visual} agentic={agentic} hasGroundTruth={hasGroundTruth} />
        </div>
      </div>
    </section>
  )
}
