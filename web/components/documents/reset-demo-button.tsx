"use client"

import { useState } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { clearClientState } from "@/lib/reset"

/** Presenter reset: deletes every upload, then clears chat/tour/theme by reloading home with clean storage. */
export function ResetDemoButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reset() {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch("/api/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error ?? `Reset failed (${r.status})`)
      clearClientState(sessionStorage, localStorage)
      window.location.assign("/")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="reset-demo">
          <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
          Reset demo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset the demo?</DialogTitle>
          <DialogDescription>
            Deletes every Uploaded Document and its Parse Runs, clears the chat, closes any tour or highlight and switches to the light theme. The Corpus and its stored results are kept.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button onClick={reset} disabled={busy} data-testid="reset-demo-confirm">
            {busy ? "Resetting…" : "Reset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
