import { querySnowflake } from "@/lib/snowflake"
import { errorResponse, isValidDocId, toIso, toNumberOrNull } from "@/lib/api-utils"

export const dynamic = "force-dynamic"

const MODE_ORDER = ["OCR", "LAYOUT", "AGENTIC"]

const SQL = `SELECT p.RUN_ID, p.DOC_ID, p.MODE, p.FINISHED_AT, p.PAGE_INDEX, p.CONTENT, p.PAGE_WIDTH, p.PAGE_HEIGHT
FROM SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.PARSE_PAGES p
JOIN SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.LATEST_RUNS l ON l.RUN_ID = p.RUN_ID
WHERE p.DOC_ID = ?
ORDER BY p.MODE, p.PAGE_INDEX`

interface Run {
  mode: string
  runId: string
  finishedAt: string | null
  pages: { index: number; content: string; width: number | null; height: number | null }[]
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidDocId(id)) return Response.json({ error: "Invalid document id" }, { status: 400 })
  try {
    const rows = await querySnowflake(SQL, { binds: [id] })
    const byMode = new Map<string, Run>()
    for (const r of rows) {
      let run = byMode.get(r.MODE)
      if (!run) {
        run = { mode: r.MODE, runId: r.RUN_ID, finishedAt: toIso(r.FINISHED_AT), pages: [] }
        byMode.set(r.MODE, run)
      }
      run.pages.push({
        index: Number(r.PAGE_INDEX),
        content: r.CONTENT ?? "",
        width: toNumberOrNull(r.PAGE_WIDTH),
        height: toNumberOrNull(r.PAGE_HEIGHT),
      })
    }
    const runs = [...byMode.values()].sort((a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode))
    for (const run of runs) run.pages.sort((a, b) => a.index - b.index)
    return Response.json({ runs })
  } catch (e) {
    return errorResponse(e, "Failed to load parse runs")
  }
}
