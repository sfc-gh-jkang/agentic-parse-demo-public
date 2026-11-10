import { querySnowflake } from "@/lib/snowflake"
import { errorResponse, isValidDocId, toIso, toJsonValue } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

const MODE_ORDER = ["OCR", "LAYOUT", "AGENTIC"]

// Stored scores only: COMPARE_MODES / REFRESH_MODE_COMPARISONS are never called from the app.
const SQL = `SELECT MODE, IMAGE_FACTS, IMAGE_FACTS_FOUND, TEXT_FACTS, TEXT_FACTS_FOUND, RELATIONS, RELATIONS_FOUND,
       VISUALS_EXPECTED, VISUALS_DETECTED, MATCHES, MISSED, RUN_ID, SCORED_AT
FROM SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.MODE_COMPARISONS
WHERE DOC_ID = ?`

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidDocId(id)) return Response.json({ error: "Invalid document id" }, { status: 400 })
  try {
    const rows = await querySnowflake(SQL, { binds: [id] })
    const comparisons = rows
      .map((r) => {
        const missed = toJsonValue<{ facts?: unknown[]; visuals?: unknown[] }>(r.MISSED, {})
        return {
          mode: String(r.MODE),
          runId: String(r.RUN_ID),
          scoredAt: toIso(r.SCORED_AT),
          imageFacts: num(r.IMAGE_FACTS),
          imageFactsFound: num(r.IMAGE_FACTS_FOUND),
          textFacts: num(r.TEXT_FACTS),
          textFactsFound: num(r.TEXT_FACTS_FOUND),
          relations: num(r.RELATIONS),
          relationsFound: num(r.RELATIONS_FOUND),
          visualsExpected: num(r.VISUALS_EXPECTED),
          visualsDetected: num(r.VISUALS_DETECTED),
          matches: toJsonValue<unknown[]>(r.MATCHES, []),
          missed: { facts: missed.facts ?? [], visuals: missed.visuals ?? [] },
        }
      })
      .sort((a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode))
    return Response.json({ comparisons })
  } catch (e) {
    return errorResponse(e, "Failed to load mode comparison")
  }
}
