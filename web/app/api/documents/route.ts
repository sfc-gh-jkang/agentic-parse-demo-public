import { querySnowflake } from "@/lib/snowflake"
import { errorResponse, toIso, toNumberOrNull, toStringArray } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

const SQL = `SELECT DOC_ID, SOURCE, FILE_TYPE, STAGE_PATH, ADDED_AT, PAGES, MODES_PARSED, LAST_PARSED_AT, HAS_GROUND_TRUTH
FROM SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCUMENT_CATALOG
ORDER BY DOC_ID`

export async function GET() {
  try {
    const rows = await querySnowflake(SQL)
    return Response.json({
      documents: rows.map((r) => ({
        docId: r.DOC_ID,
        source: r.SOURCE,
        fileType: r.FILE_TYPE,
        addedAt: toIso(r.ADDED_AT),
        pages: toNumberOrNull(r.PAGES),
        modesParsed: toStringArray(r.MODES_PARSED),
        lastParsedAt: toIso(r.LAST_PARSED_AT),
        hasGroundTruth: Boolean(r.HAS_GROUND_TRUTH),
      })),
    })
  } catch (e) {
    return errorResponse(e, "Failed to load documents")
  }
}
