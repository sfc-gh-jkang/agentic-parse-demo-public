import { querySnowflake } from "@/lib/snowflake"
import { errorResponse, isValidDocId, toJsonValue, toNumberOrNull } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

// Visuals of the latest AGENTIC Parse Run. PARSE_VISUALS holds AGENTIC runs only; X0..Y1 are
// normalized 0..1 and NULL for image files (the Visual is the whole image).
const SQL = `SELECT v.VISUAL_ID, v.PAGE_INDEX, v.IMAGE_TYPE, v.SUMMARY, v.VISIBLE_TEXT, v.DETAILS, v.FAILED,
       v.X0, v.Y0, v.X1, v.Y1
FROM SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.PARSE_VISUALS v
JOIN SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.LATEST_RUNS l ON l.RUN_ID = v.RUN_ID
WHERE v.DOC_ID = ?
ORDER BY v.PAGE_INDEX, v.VISUAL_ID`

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidDocId(id)) return Response.json({ error: "Invalid document id" }, { status: 400 })
  try {
    const rows = await querySnowflake(SQL, { binds: [id] })
    const visuals = rows.map((r) => ({
      visualId: String(r.VISUAL_ID),
      page: Number(r.PAGE_INDEX),
      imageType: r.IMAGE_TYPE ?? null,
      summary: r.SUMMARY ?? "",
      visibleText: r.VISIBLE_TEXT ?? "",
      details: toJsonValue<unknown>(r.DETAILS, null),
      failed: Boolean(r.FAILED),
      x0: toNumberOrNull(r.X0),
      y0: toNumberOrNull(r.Y0),
      x1: toNumberOrNull(r.X1),
      y1: toNumberOrNull(r.Y1),
    }))
    return Response.json({ visuals })
  } catch (e) {
    return errorResponse(e, "Failed to load visuals")
  }
}
