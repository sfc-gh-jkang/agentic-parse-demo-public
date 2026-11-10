"use client"

export interface EvalSummary {
  date: string
  winner: string
  why: string
  models: { model: string; passed: number; total: number; median_secs: number }[]
  trajectory: { model: string; id: string; expected: string[]; order: number; calls: number; redundant: number }[]
}

/** The latest committed agent eval (docs/model-eval.md): pass counts per model and the tool-order trajectory scores. */
export function EvalResults({ summary }: { summary: EvalSummary }) {
  return (
    <div className="space-y-2 text-xs" data-testid="eval-results">
      <p className="font-semibold">Agent eval, run {summary.date}</p>
      <p className="text-muted-foreground">
        Same questions asked of a temporary copy of the Demo Agent per model, with a machine check on every answer. Pinned model: {summary.winner} ({summary.why}).
      </p>
      <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-x-0 text-left [&_td]:py-0.5 [&_td]:pr-4 [&_th]:whitespace-nowrap [&_th]:pb-1 [&_th]:pr-4 [&_th]:font-semibold [&_td:last-child]:pr-0 [&_th:last-child]:pr-0">
        <thead><tr><th>Model</th><th>Passed</th><th>Median s</th></tr></thead>
        <tbody>
          {summary.models.map((m) => (
            <tr key={m.model}><td>{m.model}</td><td>{m.passed} / {m.total}</td><td>{m.median_secs}</td></tr>
          ))}
        </tbody>
      </table></div>
      <p className="pt-1 font-semibold">Tool order (did it call the right tools, in order, without repeats?)</p>
      <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-x-0 text-left [&_td]:py-0.5 [&_td]:pr-4 [&_th]:whitespace-nowrap [&_th]:pb-1 [&_th]:pr-4 [&_th]:font-semibold [&_td:last-child]:pr-0 [&_th:last-child]:pr-0">
        <thead><tr><th>Question</th><th>Expected order</th><th>Model</th><th>Order</th><th>Calls</th><th>Repeats</th></tr></thead>
        <tbody>
          {summary.trajectory.map((t) => (
            <tr key={`${t.model}-${t.id}`}>
              <td>{t.id}</td><td>{t.expected.join(" > ")}</td><td>{t.model}</td>
              <td>{t.order.toFixed(2)}</td><td>{t.calls}</td><td>{t.redundant}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="text-muted-foreground">Order 1.00 = every expected tool called in that order (extra tools allowed). Repeats = the same tool called again with the same input. Source: docs/model-eval.md.</p>
    </div>
  )
}
