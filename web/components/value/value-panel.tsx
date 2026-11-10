"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"
import { Coins } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/empty-state"
import { fetchJson, prettifyDocId } from "@/lib/doc-utils"
import { assumptionsStore, bestBy, creditsText, estimateMonth, parseAssumption, parseVolume, reviewEstimate, volumeStore, volumeText, type ReviewAssumptions, type ValueStory } from "@/lib/value"
import { formatNumber } from "@/lib/format"

const MODE_ORDER = ["AGENTIC", "LAYOUT", "OCR"]

/** The value of AGENTIC in numbers, all from stored data (VALUE_STORY): measured credits, facts scored against Ground Truth. Unfavourable numbers stay in. */
export function ValuePanel() {
  const q = useQuery({ queryKey: ["value"], queryFn: () => fetchJson<ValueStory>("/api/value") })
  const volume = useSyncExternalStore(volumeStore.subscribe, volumeStore.get, () => null)
  const [text, setText] = useState("")
  useEffect(() => setText((t) => volumeText(t, volume)), [volume])
  const assumed = useSyncExternalStore(assumptionsStore.subscribe, assumptionsStore.get, assumptionsStore.get)

  return (
    <Card id="value" data-tour="value_panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5" /> What AGENTIC is worth</CardTitle>
        <p className="text-sm text-muted-foreground">
          Measured credits per Parse Mode against what each recovered from the scored Corpus. Every number is computed from stored data, favourable or not.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : q.isError ? (
          <EmptyState variant="error" title="Could not load the value story" description={q.error.message} />
        ) : (
          <Body story={q.data} volume={volume} text={text} setText={setText} assumed={assumed} />
        )}
      </CardContent>
    </Card>
  )
}

function Body({ story, volume, text, setText, assumed }: { story: ValueStory; volume: number | null; text: string; setText: (t: string) => void; assumed: ReviewAssumptions }) {
  const modes = [...story.modes].sort((a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode))
  const cheapest = bestBy(modes, "costPerCorrectFact")
  const fewest = bestBy(modes, "pagesToCheck")
  const relations = bestBy(modes, "relationsFound")
  const agentic = modes.find((m) => m.mode === "AGENTIC")
  const h = story.hardPages
  const est = volume ? estimateMonth(modes, volume) : null
  const typed = parseVolume(text)
  const rev = volume ? reviewEstimate(modes, volume, assumed) : null
  const hasReview = assumed.minutesPerPage != null
  const agenticRev = rev?.find((r) => r.mode === "AGENTIC")

  return (
    <>
      <Table data-testid="value-table">
        <TableHeader>
          <TableRow>
            <TableHead>Parse Mode</TableHead>
            <TableHead numeric>Pages to check by hand</TableHead>
            <TableHead numeric>Relations found</TableHead>
            <TableHead numeric>Facts found</TableHead>
            <TableHead numeric>Credits / 1k pages</TableHead>
            <TableHead numeric className="font-normal text-muted-foreground">Credits per correct fact</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {modes.map((m) => (
            <TableRow key={m.mode} data-mode={m.mode}>
              <TableCell className="font-medium">{m.mode}</TableCell>
              <TableCell numeric className="font-semibold" data-testid={`check-${m.mode}`}>{m.pagesToCheck} of {m.corpusPages}</TableCell>
              <TableCell numeric className="font-semibold" data-testid={`relations-${m.mode}`}>{m.relationsFound} of {m.relations}</TableCell>
              <TableCell numeric>{m.factsFound} of {m.facts}</TableCell>
              <TableCell numeric>{formatNumber(m.creditsPer1kPages, 2)}</TableCell>
              <TableCell numeric className="text-muted-foreground" title={m.derivation}><span className="underline decoration-dotted underline-offset-2" data-testid={`cpcf-${m.mode}`}>{creditsText(m.costPerCorrectFact)}</span></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        &ldquo;Pages to check by hand&rdquo; counts pages where the Mode missed at least one answer-key fact. Hover a cost figure or open the derivation below.
      </p>

      <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm" data-testid="value-derivation">
        <summary className="cursor-pointer font-medium">How cost per correct fact is computed</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {modes.map((m) => <li key={m.mode}><span className="font-medium text-foreground">{m.mode}:</span> {m.derivation}</li>)}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{story.basis}</p>
      </details>

      <div className="space-y-2 text-sm" data-testid="value-takeaways">
        {cheapest && fewest && relations && (
          <p>
            <span className="font-medium">Honest reading:</span> AGENTIC leaves the fewest pages to check by hand ({fewest.mode === "AGENTIC" ? `${fewest.pagesToCheck} of ${fewest.corpusPages}` : fewest.mode}
            {agentic ? `, against ${modes.filter((m) => m.mode !== "AGENTIC").map((m) => `${m.pagesToCheck} for ${m.mode}`).join(" and ")}` : ""}) and recovers the most relations
            ({relations.relationsFound} of {relations.relations}). It does not win on credits per correct fact: {cheapest.mode} is cheapest there ({creditsText(cheapest.costPerCorrectFact)} credits
            {agentic && cheapest.mode !== "AGENTIC" ? `, ${formatNumber(agentic.costPerCorrectFact / cheapest.costPerCorrectFact, 1)} times less than AGENTIC` : ""}). What AGENTIC buys is the hard pages and the hours of review they would
            otherwise need; whether that pays depends on your own review time, entered below.
          </p>
        )}
        {story.controlDocs.length > 0 && (
          <p data-testid="value-control">
            <span className="font-medium">Where AGENTIC is not needed:</span>{" "}
            {story.controlDocs.map((c, i) => (
              <span key={c.doc}>{i > 0 ? "; " : ""}{prettifyDocId(c.doc)} ({c.cheapestMode} found all {c.factsFound} facts{c.relationsFound ? ` and ${c.relationsFound} relations` : ""}
              ; AGENTIC costs {formatNumber(c.agenticCreditsMultiple, 1)} times more per page)</span>
            ))}
            . On these Documents a cheaper Mode matched AGENTIC.
          </p>
        )}
        <p data-testid="value-recommendation">
          <span className="font-medium">Recommendation: route hard pages to AGENTIC.</span> OCR or LAYOUT missed facts on {h.pagesHard} of {h.pagesTotal} pages.
          OCR everywhere plus AGENTIC on just those pages would cost {creditsText(h.routedCredits)} credits against {creditsText(h.agenticEverywhereCredits)} for AGENTIC on all {h.pagesTotal}.
          <span className="text-muted-foreground"> {h.note}</span>
        </p>
      </div>

      <div className="rounded-lg border p-3" data-tour="volume_input">
        <label className="flex flex-wrap items-center gap-2 text-sm font-medium" htmlFor="volume-input">
          Pages per month
          <input
            id="volume-input"
            data-testid="volume-input"
            inputMode="numeric"
            placeholder="e.g. 50,000"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              volumeStore.set(parseVolume(e.target.value))
            }}
            className="h-9 w-40 rounded-md border bg-background px-2 text-right text-sm tabular-nums"
            aria-invalid={text !== "" && typed === null}
          />
        </label>
        {text !== "" && typed === null && <p className="mt-1 text-xs text-destructive">Enter a whole number of pages, 1 to 1,000,000,000.</p>}
        <fieldset className="mt-3 rounded-md border border-dashed p-2" data-testid="review-assumptions">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Cost including review: your assumptions (blank = not assumed)</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            <AssumptionBox id="review-minutes" label="Minutes of human review per page to check" placeholder="your estimate" value={assumed.minutesPerPage} max={600}
              onChange={(v) => assumptionsStore.set({ minutesPerPage: v })} />
            <AssumptionBox id="hourly-rate" label="Reviewer hourly rate" placeholder="your rate" value={assumed.hourlyRate} max={100000}
              onChange={(v) => assumptionsStore.set({ hourlyRate: v })} />
            <AssumptionBox id="credit-price" label="Price per credit (optional)" placeholder="your price" value={assumed.pricePerCredit} max={100000}
              onChange={(v) => assumptionsStore.set({ pricePerCredit: v })} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Credits stay credits unless you enter a price per credit; nothing here is a Snowflake price or a quote. Review hours = pages to check per month x minutes / 60.
          </p>
        </fieldset>
        {est ? (
          <div className="mt-2" data-testid="volume-result">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parse Mode</TableHead>
                  <TableHead numeric>Credits / month</TableHead>
                  <TableHead numeric>Facts recovered / month</TableHead>
                  <TableHead numeric>To check / month</TableHead>
                  {hasReview && <TableHead numeric>Review hours</TableHead>}
                  {assumed.hourlyRate != null && hasReview && <TableHead numeric>Review cost</TableHead>}
                  {assumed.pricePerCredit != null && <TableHead numeric>AI cost</TableHead>}
                  {assumed.pricePerCredit != null && assumed.hourlyRate != null && hasReview && <TableHead numeric>Total</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {est.map((e) => (
                  <TableRow key={e.mode} data-mode={e.mode}>
                    <TableCell className="font-medium">{e.mode}</TableCell>
                    <TableCell numeric data-testid={`month-credits-${e.mode}`}>{creditsText(e.monthlyCredits)}</TableCell>
                    <TableCell numeric>{formatNumber(Math.round(e.expectedFacts), 0)}</TableCell>
                    {(() => {
                      const r = rev?.find((x) => x.mode === e.mode)
                      if (!r) return null
                      return (
                        <>
                          <TableCell numeric data-testid={`month-check-${e.mode}`}>{formatNumber(Math.round(r.pagesToCheckPerMonth), 0)}</TableCell>
                          {hasReview && <TableCell numeric title={r.derivation} data-testid={`review-hours-${e.mode}`}>{formatNumber(r.reviewHours ?? 0, 0)}</TableCell>}
                          {r.reviewCost != null && <TableCell numeric title={r.derivation} data-testid={`review-cost-${e.mode}`}>{formatNumber(r.reviewCost, 0)}</TableCell>}
                          {r.creditsCost != null && <TableCell numeric title={r.derivation} data-testid={`ai-cost-${e.mode}`}>{formatNumber(r.creditsCost, 0)}</TableCell>}
                          {r.totalCost != null && <TableCell numeric title={r.derivation} className="font-semibold" data-testid={`total-${e.mode}`}>{formatNumber(r.totalCost, 0)}</TableCell>}
                        </>
                      )
                    })()}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {hasReview && agenticRev && (
              <p className="mt-2 text-sm" data-testid="hours-saved">
                <span className="font-medium">With your assumptions,</span> AGENTIC leaves {formatNumber(Math.round(agenticRev.reviewHours ?? 0), 0)} review hours a month
                {rev!.filter((r) => r.hoursSavedByAgentic != null).map((r) => `; ${formatNumber(Math.round(r.hoursSavedByAgentic!), 0)} fewer than ${r.mode}`).join("")}.
                {assumed.pricePerCredit == null && " AGENTIC uses more AI credits than the other Modes; enter a price per credit to put credits and review time in one total."}
                {assumed.pricePerCredit != null && assumed.hourlyRate != null && " Hover a figure for its arithmetic."}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground" data-testid="volume-label">
              Estimate from measured rates on this corpus: pages x measured credits per page, and pages x facts found per corpus page. Your mix of Documents will differ. Review figures use only the assumptions you entered.
            </p>
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">Type a monthly volume to see AI credits and expected facts recovered per Parse Mode.</p>
        )}
      </div>
    </>
  )
}

function AssumptionBox({ id, label, placeholder, value, max, onChange }: {
  id: string; label: string; placeholder: string; value: number | null; max: number; onChange: (v: number | null) => void
}) {
  const [text, setText] = useState(value == null ? "" : String(value))
  useEffect(() => setText(value == null ? "" : String(value)), [value])
  const parsed = parseAssumption(text, max)
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" htmlFor={id}>
      {label}
      <input
        id={id}
        data-testid={id}
        inputMode="decimal"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = parseAssumption(e.target.value, max)
          if (v !== undefined) onChange(v)
        }}
        className="h-9 w-44 rounded-md border bg-background px-2 text-right text-sm tabular-nums"
        aria-invalid={parsed === undefined}
      />
    </label>
  )
}
