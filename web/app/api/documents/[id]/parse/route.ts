import { querySnowflakeLongRunning } from "@/lib/snowflake"
import { errorResponse, guardJsonPost, isValidDocId } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

const MODES = ["OCR", "LAYOUT", "AGENTIC"]

// Parses take 5-45 s and spend AI credits: this is the only route that calls APP_PARSE.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const refused = guardJsonPost(req)
  if (refused) return refused
  const { id } = await params
  if (!isValidDocId(id)) return Response.json({ error: "Invalid document id" }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const mode = String(body?.mode ?? "").toUpperCase()
  if (!MODES.includes(mode)) return Response.json({ error: "mode must be OCR, LAYOUT or AGENTIC" }, { status: 400 })
  try {
    const rows = await querySnowflakeLongRunning("CALL SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.APP_PARSE(?, ?)", {
      binds: [id, mode],
    })
    const result = JSON.parse(String(Object.values(rows[0])[0]))
    return Response.json(result, { status: result.ok ? 200 : 422 })
  } catch (e) {
    return errorResponse(e, "Parse failed")
  }
}
