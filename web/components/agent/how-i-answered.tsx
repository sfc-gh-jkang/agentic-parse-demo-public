"use client"

import { explainSteps, type Step } from "@/lib/agent-stream"

/** Collapsed-by-default list of what the agent did, in order, in plain language. */
export function HowIAnswered({ steps, done }: { steps: Step[]; done: boolean }) {
  if (steps.length === 0) return null
  const lines = explainSteps(steps)
  // The platform repeats generic status lines ("Planning the next steps"); show them only when nothing richer arrived.
  const rich = steps.map((s, i) => ({ s, line: lines[i] })).filter((x) => x.s.kind !== "status")
  const shown = rich.length ? rich : steps.map((s, i) => ({ s, line: lines[i] }))
  const calls = steps.filter((s) => s.kind === "tool").length
  return (
    <details className="rounded border bg-muted/40 px-2 py-1 text-xs" data-testid="how-i-answered">
      <summary className="cursor-pointer select-none font-medium">
        How I answered{done ? ` (${calls} tool ${calls === 1 ? "call" : "calls"})` : "…"}
      </summary>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
        {shown.map(({ s, line }, i) => (
          <li key={i} className={s.kind === "thinking" ? "italic" : undefined}>
            {s.kind === "thinking" ? `Thinking: ${line}` : line}
          </li>
        ))}
      </ol>
    </details>
  )
}
