"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Loader2, UploadCloud, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PARSE_MODES, type ParseMode } from "@/lib/doc-utils"
import { ACCEPT_ATTR, LIMITS_TEXT, addLiveRunId, checkUploadFile } from "@/lib/upload-utils"

type Row = { state: "queued" | "parsing" | "done" | "failed"; detail?: string; startedAt?: number }

export function UploadCard() {
  const router = useRouter()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [modes, setModes] = useState<Record<ParseMode, boolean>>({ OCR: true, LAYOUT: true, AGENTIC: true })
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [docId, setDocId] = useState<string | null>(null)
  const [rows, setRows] = useState<Partial<Record<ParseMode, Row>>>({})
  const [, tick] = useState(0)

  const running = uploading || Object.values(rows).some((r) => r?.state === "queued" || r?.state === "parsing")
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  const setRow = (m: ParseMode, row: Row) => setRows((r) => ({ ...r, [m]: row }))

  async function parse(id: string, m: ParseMode): Promise<boolean> {
    setRow(m, { state: "parsing", startedAt: Date.now() })
    try {
      const res = await fetch(`/api/documents/${id}/parse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: m }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
      if (body.run_id) addLiveRunId(body.run_id)
      if (body.error) throw new Error(String(body.error))
      setRow(m, { state: "done", detail: `${body.pages ?? "?"} page${body.pages === 1 ? "" : "s"}` })
      return true
    } catch (e) {
      setRow(m, { state: "failed", detail: e instanceof Error ? e.message : "Parse failed" })
      return false
    }
  }

  async function start(file: File) {
    const chosen = PARSE_MODES.filter((m) => modes[m])
    setError(null)
    setDocId(null)
    setRows({})
    setFileName(file.name)
    const rejected = checkUploadFile(file.name, file.size)
    if (rejected) return setError(rejected.error)
    if (chosen.length === 0) return setError("Pick at least one Parse Mode.")
    setUploading(true)
    try {
      const fd = new FormData()
      fd.set("file", file)
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) throw new Error(body.error ?? `Upload failed (${res.status})`)
      setDocId(body.doc_id)
      qc.invalidateQueries({ queryKey: ["documents"] })
      setRows(Object.fromEntries(chosen.map((m) => [m, { state: "queued" } as Row])))
      setUploading(false)
      const results = await Promise.all(chosen.map((m) => parse(body.doc_id, m)))
      qc.invalidateQueries({ queryKey: ["documents"] })
      if (results.every(Boolean)) router.push(`/documents/${body.doc_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const pick = (f?: File | null) => f && start(f)

  return (
    <Card data-tour="upload_card">
      <CardHeader>
        <CardTitle>Upload a Document</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]) }}
          className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center ${dragging ? "border-primary bg-muted" : ""}`}
        >
          <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm">Drag a file here or</p>
          <Button size="sm" variant="outline" disabled={running} onClick={() => input.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={input}
            data-testid="upload-input"
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => { pick(e.target.files?.[0]); e.target.value = "" }}
          />
          <p className="text-xs text-muted-foreground">{LIMITS_TEXT}</p>
        </div>

        <fieldset className="flex flex-wrap items-center gap-4 text-sm" disabled={running}>
          <legend className="sr-only">Parse Modes to run after upload</legend>
          <span className="text-muted-foreground">Parse after upload:</span>
          {PARSE_MODES.map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={modes[m]}
                onChange={(e) => setModes((s) => ({ ...s, [m]: e.target.checked }))}
              />
              {m}
            </label>
          ))}
        </fieldset>

        {fileName && <p className="text-sm font-medium">{fileName}</p>}
        {uploading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
          </p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {Object.keys(rows).length > 0 && (
          <ul className="space-y-1 text-sm" data-testid="parse-progress">
            {PARSE_MODES.filter((m) => rows[m]).map((m) => {
              const r = rows[m]!
              return (
                <li key={m} className="flex items-center gap-2" data-mode={m} data-state={r.state}>
                  <span className="w-20 font-semibold">{m}</span>
                  {r.state === "queued" && <span className="text-muted-foreground">Queued</span>}
                  {r.state === "parsing" && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Parsing… {Math.round((Date.now() - (r.startedAt ?? Date.now())) / 1000)}s
                    </span>
                  )}
                  {r.state === "done" && (
                    <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="h-4 w-4" /> Done · {r.detail}</span>
                  )}
                  {r.state === "failed" && (
                    <span className="flex items-center gap-1 text-destructive"><XCircle className="h-4 w-4" /> Failed: {r.detail}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {docId && !running && (
          <Button onClick={() => router.push(`/documents/${docId}`)}>Open in viewer</Button>
        )}
      </CardContent>
    </Card>
  )
}
