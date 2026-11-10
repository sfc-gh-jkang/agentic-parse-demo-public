"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ParseMode } from "@/lib/doc-utils"
import { addLiveRunId } from "@/lib/upload-utils"

/** Re-parses one Document in one Parse Mode (spends AI credits), then refetches what the viewer shows. */
export function RunButton({ docId, mode, onDone }: { docId: string; mode: ParseMode; onDone: () => void }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/documents/${docId}/parse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
      if (body.run_id) addLiveRunId(body.run_id)
      if (body.error) setError(String(body.error))
      await Promise.all(
        ["runs", "visuals", "comparison", "documents"].map((k) =>
          qc.invalidateQueries({ queryKey: k === "documents" ? [k] : [k, docId] }),
        ),
      )
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2" data-tour="run_button">
      <Button size="sm" variant="outline" disabled={busy} onClick={run} data-testid={`run-${mode}`}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
        {busy ? "Parsing…" : `Run ${mode}`}
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  )
}
