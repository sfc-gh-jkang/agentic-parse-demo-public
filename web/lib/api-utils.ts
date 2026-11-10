const DOC_ID_PATTERN = /^[a-z0-9_]{1,64}$/

export function isValidDocId(id: string): boolean {
  return DOC_ID_PATTERN.test(id)
}

/** Snowflake TIMESTAMP columns arrive as Date objects; send ISO strings. */
export function toIso(val: unknown): string | null {
  if (!val) return null
  if (val instanceof Date) return val.toISOString()
  return String(val)
}

/** Snowflake ARRAY columns arrive as JSON strings from the Node.js driver. */
export function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === "string" && val) {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

/** NUMBER columns may arrive as strings; null stays null. */
export function toNumberOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

/** Logs the real error server-side; the client gets only `fallback`, never Snowflake's message (object names, SQL, query ids). */
export function errorResponse(e: unknown, fallback: string, status = 500): Response {
  console.error(new Date().toISOString(), `[api] ${fallback}`, e)
  return Response.json({ error: fallback }, { status })
}

/**
 * 403 for a request a browser marks as coming from another site. A cross-site HTML form can POST with the
 * viewer's session cookie and no CORS preflight, which would let another page spend AI credits (parse, ask,
 * agent, upload) or reset the demo. Browsers always send Sec-Fetch-Site; scripts with a token send none.
 */
export function rejectCrossSite(req: Request): Response | null {
  const site = req.headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") return Response.json({ error: "Cross-site request refused" }, { status: 403 })
  return null
}

/** 415 unless the body is declared JSON: forms cannot send application/json without a CORS preflight. */
export function requireJson(req: Request): Response | null {
  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return null
  return Response.json({ error: "Expected Content-Type: application/json" }, { status: 415 })
}

/** Both guards for a JSON POST route. */
export function guardJsonPost(req: Request): Response | null {
  return rejectCrossSite(req) ?? requireJson(req)
}

/** VARIANT columns arrive as parsed objects or as JSON strings; normalize to a value (or the fallback). */
export function toJsonValue<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined || val === "") return fallback
  if (typeof val === "string") {
    try {
      return (JSON.parse(val) ?? fallback) as T
    } catch {
      return fallback
    }
  }
  return val as T
}
