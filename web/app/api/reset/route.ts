import { querySnowflake } from "@/lib/snowflake"
import { errorResponse, guardJsonPost } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

const S = "SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO"

/**
 * Presenter reset: RESET_DEMO deletes every Uploaded Document's rows and refreshes search;
 * REMOVE is not allowed inside a procedure, so the stage files are removed here as separate
 * statements. The Corpus is untouched. Not reachable from the agent (no tool calls this).
 */
export async function POST(req: Request) {
  // JSON only: a cross-site HTML form can POST text/plain or form data with the viewer's
  // session without a CORS preflight, which would let another page reset the demo.
  const refused = guardJsonPost(req)
  if (refused) return refused
  try {
    const rows = await querySnowflake(`CALL ${S}.RESET_DEMO()`)
    const result = JSON.parse(String(Object.values(rows[0])[0]))
    await querySnowflake(`REMOVE @${S}.DOCS/uploads/`)
    await querySnowflake(`ALTER STAGE ${S}.DOCS REFRESH`)
    return Response.json({ ok: true, uploadsRemoved: result.uploads_removed })
  } catch (e) {
    return errorResponse(e, "Reset failed")
  }
}
