import { querySnowflake } from "@/lib/snowflake"
import { errorResponse, isValidDocId } from "@/lib/api-utils"
import { cache, remember, type Entry } from "@/lib/file-cache"

export const dynamic = "force-dynamic"

const SQL = `SELECT CONTENT, CONTENT_TYPE, SHA256
FROM SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCUMENT_FILES
WHERE DOC_ID = ?`

function toBuffer(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v
  if (v instanceof Uint8Array) return Buffer.from(v)
  return Buffer.from(String(v), "hex")
}

function respond(req: Request, e: Entry): Response {
  const etag = `"${e.sha}"`
  const headers = { ETag: etag, "Cache-Control": "private, max-age=300" }
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers })
  return new Response(new Uint8Array(e.bytes), { headers: { ...headers, "Content-Type": e.contentType } })
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidDocId(id)) return Response.json({ error: "Invalid document id" }, { status: 400 })
  try {
    const hit = cache.get(id)
    if (hit) {
      cache.delete(id)
      cache.set(id, hit)
      return respond(req, hit)
    }
    const rows = await querySnowflake(SQL, { binds: [id] })
    const r = rows[0]
    if (!r || r.CONTENT == null) return Response.json({ error: "Document not found" }, { status: 404 })
    const entry: Entry = { sha: String(r.SHA256), contentType: String(r.CONTENT_TYPE), bytes: toBuffer(r.CONTENT) }
    remember(id, entry)
    return respond(req, entry)
  } catch (e) {
    return errorResponse(e, "Failed to load document file")
  }
}
