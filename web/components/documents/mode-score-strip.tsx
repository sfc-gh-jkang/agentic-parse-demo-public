"use client"

import { Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { agenticFirst, formatScore, groupMissed, type MissedGroup } from "@/lib/viewer-utils"
import type { ModeComparison, ParseMode } from "@/lib/doc-utils"

const RELATIONS_HELP = "Relations = a value paired with its label, edge or row (for example “Q3 = 13.8”)."

function Score({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <span className="whitespace-nowrap" title={help}>
      <span className="text-muted-foreground">{label} </span>
      <span className="font-semibold tabular-nums">{value}</span>
      {help && <Info className="ml-0.5 inline h-3 w-3 text-muted-foreground" aria-hidden />}
    </span>
  )
}

/** Compact scores of the shown Parse Modes against Ground Truth, from stored Mode Comparison rows. */
export function ModeScoreStrip({
  loading = false,
  modes,
  comparisons,
  hasGroundTruth,
  missedOpen,
  onMissedToggle,
}: {
  /** Document or comparisons still loading: show a neutral placeholder, not the "no Ground Truth" note. */
  loading?: boolean
  modes: ParseMode[]
  comparisons: ModeComparison[]
  hasGroundTruth: boolean
  /** "What was missed" is controlled, so the Demo Agent can open it. */
  missedOpen: boolean
  onMissedToggle: (open: boolean) => void
}) {
  const rows = modes.map((m) => ({ mode: m, c: comparisons.find((x) => x.mode === m) }))
  if (loading) {
    return (
      <div data-tour="score_strip" aria-busy="true" className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Loading scores…
      </div>
    )
  }
  if (!hasGroundTruth || comparisons.length === 0) {
    return (
      <div data-tour="score_strip" className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Uploaded Document: no Ground Truth to score against.
      </div>
    )
  }
  return (
    <div className="space-y-1 rounded-lg border px-3 py-2 text-sm">
      <div data-tour="score_strip" className="space-y-1">
        {rows.map(({ mode, c }) => (
          <div key={mode} className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className={cn("w-20 font-semibold", mode === "AGENTIC" && "text-amber-700 dark:text-amber-400")}>{mode}</span>
            {c ? (
              <>
                <Score label="Relations found" value={formatScore(c.relationsFound, c.relations)} help={RELATIONS_HELP} />
                <Score label="Facts inside images" value={formatScore(c.imageFactsFound, c.imageFacts)} />
                <Score
                  label="Visuals detected"
                  value={mode === "AGENTIC" ? formatScore(c.visualsDetected, c.visualsExpected) : "n/a"}
                />
              </>
            ) : (
              <span className="text-muted-foreground">not scored</span>
            )}
          </div>
        ))}
      </div>
      <details data-tour="what_was_missed" className="pt-1" open={missedOpen} onToggle={(e) => onMissedToggle(e.currentTarget.open)}>
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What was missed</summary>
        <div className="mt-2 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(rows.length, 3)}, minmax(0, 1fr))` }}>
          {agenticFirst(rows).map(({ mode, c }) => (
            <div key={mode} data-testid={`missed-${mode}`} className="max-h-60 overflow-auto rounded border bg-muted/30 p-2">
              <div className={cn("mb-1 font-semibold", mode === "AGENTIC" && "text-amber-700 dark:text-amber-400")}>{mode}</div>
              {!c ? (
                <p className="text-muted-foreground">Not scored.</p>
              ) : c.missed.facts.length === 0 && c.missed.visuals.length === 0 ? (
                <p className="text-muted-foreground">Nothing missed.</p>
              ) : (
                groupMissed(c.missed).map((g) => <MissedList key={g.label} group={g} />)
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

const SHOW_FIRST = 3

function MissedList({ group }: { group: MissedGroup }) {
  const [all, setAll] = useState(false)
  const shown = all ? group.items : group.items.slice(0, SHOW_FIRST)
  return (
    <div className="mb-2">
      <div className="text-muted-foreground">
        {group.label}: <span className="tabular-nums">{group.items.length}</span>
      </div>
      <ul className="list-disc pl-5">
        {shown.map((t, i) => (
          <li key={i} className="break-words">{t}</li>
        ))}
      </ul>
      {group.items.length > SHOW_FIRST && (
        <button type="button" className="pl-5 text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `+${group.items.length - SHOW_FIRST} more`}
        </button>
      )}
    </div>
  )
}
