"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AskResult } from "@/lib/ask"

export type CompareState = { status: "loading"; doc: string } | { status: "done"; result: AskResult } | { status: "error"; doc: string; message: string } | { status: "nodoc" }

/** Three rows under an agent reply: what each Parse Mode's text alone can answer. Page chips are 1-based. */
export function CompareTable({ state, onPage }: { state: CompareState; onPage: (doc: string, page: number) => void }) {
  if (state.status === "nodoc")
    return <p className="text-xs text-muted-foreground" data-testid="compare-hint">Open a Document (or name one in your question) to compare answers across modes.</p>
  if (state.status === "loading")
    return <p className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="compare-loading"><Loader2 className="h-3 w-3 animate-spin" /> Asking AGENTIC, LAYOUT and OCR parses of {state.doc}…</p>
  if (state.status === "error") return <p className="text-xs text-destructive" data-testid="compare-error">Mode comparison failed: {state.message}</p>
  const { result } = state
  return (
    <div className="rounded border text-xs" data-testid="compare-table" data-tour="compare_answers_table">
      <div className="border-b bg-muted/40 px-2 py-1 text-muted-foreground">Answered from each mode&apos;s parse of <strong>{result.doc}</strong> only</div>
      <table className="w-full">
        <tbody>
          {result.answers.map((a) => (
            <tr key={a.mode} data-testid={`compare-row-${a.mode}`} className={cn("border-b last:border-0", a.mode === "AGENTIC" && "bg-amber-50 dark:bg-amber-950/40")}>
              <th className={cn("w-[72px] p-1.5 text-left align-top font-semibold", a.mode === "AGENTIC" && "text-amber-800 dark:text-amber-300")}>{a.mode}</th>
              <td className="p-1.5 align-top">
                {a.found ? <span>{a.answer}</span> : <span className="italic text-muted-foreground">{a.noParse || a.error ? a.answer : "Not found in this parse"}</span>}
                <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                  {a.pages.map((p) => (
                    <button key={p} type="button" onClick={() => onPage(result.doc, p)} className="rounded-full border bg-background px-1.5 text-[11px] hover:bg-accent" title="Jump the viewer here">p. {p}</button>
                  ))}
                </span>
              </td>
              <td className="w-10 p-1.5 text-right align-top text-[10px] text-muted-foreground">{(a.ms / 1000).toFixed(1)}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
