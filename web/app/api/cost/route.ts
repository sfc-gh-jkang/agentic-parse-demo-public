import { querySnowflake } from "@/lib/snowflake"
import { errorResponse, toIso, toNumberOrNull } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await querySnowflake("CALL SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.PARSE_COST(NULL)")
    return Response.json({
      modes: rows.map((r) => ({
        mode: r.MODE,
        runs: toNumberOrNull(r.RUNS) ?? 0,
        measuredRuns: toNumberOrNull(r.MEASURED_RUNS) ?? 0,
        pendingRuns: toNumberOrNull(r.PENDING_RUNS) ?? 0,
        pagesBilled: toNumberOrNull(r.PAGES_BILLED),
        credits: toNumberOrNull(r.CREDITS),
        creditsPer1kPages: toNumberOrNull(r.CREDITS_PER_1K_PAGES),
        measuredAt: toIso(r.MEASURED_AT),
      })),
    })
  } catch (e) {
    return errorResponse(e, "Failed to load cost")
  }
}
