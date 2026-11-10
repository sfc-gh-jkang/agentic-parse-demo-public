"use client"

import { useState } from "react"
import { Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { creditsText } from "@/lib/value"
import { DOC_LINKS, renderSnippet, SNIPPETS, type Snippet } from "@/lib/use-data"

interface RunResult { columns: string[]; rows: Record<string, unknown>[]; billed?: boolean }
interface Confirm {
  needsConfirm: true; inputChars: number; approxInputTokens: number
  measuredRate: { calls: number; tokens: number; creditsPerMillionTokens: number } | null
  estimatedCredits: number | null
}

const cell = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v))

function SnippetCard({ snippet, doc }: { snippet: Snippet; doc: string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sql = renderSnippet(snippet.sql, doc) ?? ""

  async function run(confirmed: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/use-data/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ snippet: snippet.id, doc, confirm: confirmed }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      if (json.needsConfirm) setConfirm(json as Confirm)
      else {
        setConfirm(null)
        setResult(json as RunResult)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3" data-testid={`snippet-${snippet.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{snippet.title}</h3>
        {snippet.kind === "billed" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">billed</span>}
        {snippet.kind === "pattern" && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium" data-testid="pattern-label">pattern, not run here</span>}
        <a href={DOC_LINKS[snippet.doc_link]} target="_blank" rel="noreferrer" className="ml-auto text-xs text-primary hover:underline">Snowflake docs</a>
      </div>
      <p className="text-xs text-muted-foreground">{snippet.blurb}</p>
      <pre tabIndex={0} className="overflow-x-auto rounded bg-muted p-2 text-xs leading-relaxed" data-testid={`sql-${snippet.id}`}>{sql}</pre>
      {snippet.kind !== "pattern" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(false)} data-testid={`run-${snippet.id}`}>
            <Play className="mr-1 h-3.5 w-3.5" /> {busy ? "Running" : snippet.kind === "billed" ? "Run (billed)" : "Run"}
          </Button>
          {confirm && (
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="billed-confirm">
              <span>
                This sends about {confirm.approxInputTokens.toLocaleString("en-US")} input tokens ({confirm.inputChars.toLocaleString("en-US")} characters, at about 4 characters a token) plus the answer,
                billed in AI credits per million tokens.{" "}
                {confirm.measuredRate && confirm.estimatedCredits !== null
                  ? `Measured on this account from ${confirm.measuredRate.calls} earlier AI_EXTRACT call${confirm.measuredRate.calls === 1 ? "" : "s"}: ${creditsText(confirm.measuredRate.creditsPerMillionTokens)} credits per million tokens, so about ${creditsText(confirm.estimatedCredits)} credits for this call (input tokens only; the answer adds a few). `
                  : "No earlier AI_EXTRACT usage to measure a rate from; the exact credits show in usage history after the run. "}
                Run it?
              </span>
              <Button size="sm" disabled={busy} onClick={() => run(true)} data-testid="billed-confirm-yes">Yes, run it</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {result && (
        <div tabIndex={0} className="max-h-64 overflow-auto rounded border" data-testid={`result-${snippet.id}`}>
          {result.rows.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">No rows.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>{result.columns.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {result.rows.map((r, i) => (
                  <TableRow key={i}>{result.columns.map((c) => <TableCell key={c} className="max-w-[28rem] truncate text-xs" title={cell(r[c])}>{cell(r[c])}</TableCell>)}</TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </section>
  )
}

/** Runnable SQL for using this Document's parse output in your own pipelines. Run is read-only and allowlisted (/api/use-data/run). */
export function UseDataTab({ docId }: { docId: string }) {
  return (
    <div className="space-y-3" data-testid="use-data-tab">
      <div data-tour="use_data_tab" className="rounded-lg border bg-muted/30 p-3">
        <h2 className="text-sm font-semibold">Use this data</h2>
        <p className="text-sm text-muted-foreground">
          Every value AGENTIC read is stored, so it is data you can query. These snippets use this Document ({docId}); copy them into a worksheet.
          Run executes only the read-only ones shown here; the billed one asks first.
        </p>
      </div>
      {SNIPPETS.map((s) => <SnippetCard key={s.id} snippet={s} doc={docId} />)}
    </div>
  )
}
