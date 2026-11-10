export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_UPLOAD_PAGES = 20
export const ALLOWED_EXTENSIONS = ["pdf", "pptx", "docx", "png", "jpg", "jpeg", "tif", "tiff"] as const
export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")
export const LIMITS_TEXT = `PDF, PPTX, DOCX, PNG, JPG or TIFF · up to 10 MB · up to ${MAX_UPLOAD_PAGES} pages`

/** Returns a user-readable reason, or null when the file passes the cheap client/server pre-check. */
export function checkUploadFile(name: string, size: number): { status: 400 | 413 | 415; error: string } | null {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { status: 415, error: "Unsupported file type. Use PDF, PPTX, DOCX, PNG, JPG or TIFF." }
  }
  if (size === 0) return { status: 400, error: "The file is empty." }
  if (size > MAX_UPLOAD_BYTES) return { status: 413, error: "File is larger than the 10 MB limit." }
  return null
}

/** A run is a Live Result only if this browser session started it. */
export function resultLabel(runId: string, liveRunIds: ReadonlySet<string>): "live" | "cached" {
  return liveRunIds.has(runId) ? "live" : "cached"
}

const LIVE_KEY = "agentic-parse-demo:live-runs"
/** Fired on window when a run becomes Live, so an open viewer relabels it. */
export const LIVE_EVENT = "agentic-parse-demo:live-run"

export function loadLiveRunIds(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(LIVE_KEY) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}

export function addLiveRunId(runId: string): void {
  const ids = loadLiveRunIds()
  ids.add(runId)
  sessionStorage.setItem(LIVE_KEY, JSON.stringify([...ids]))
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LIVE_EVENT))
}
