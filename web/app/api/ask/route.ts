// One short answer per Parse Mode, each grounded only on that mode's latest parse of the Document.
// Cost: one AI_COMPLETE per mode per question (three per call).
import { querySnowflake } from "@/lib/snowflake"
import { errorResponse, guardJsonPost, isValidDocId } from "@/lib/api-utils"
import { ASK_MODEL, ASK_MODES, buildContext, buildPrompt, cleanQuestion, parseAnswer, type AskMode, type ModeAnswer, type PageRow, type VisualRow } from "@/lib/ask"

export const dynamic = "force-dynamic"
export const maxDuration = 120

const DB = "SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO"
const PAGES_SQL = `SELECT p.PAGE_INDEX, p.CONTENT FROM ${DB}.PARSE_PAGES p
JOIN ${DB}.LATEST_RUNS l ON l.RUN_ID = p.RUN_ID
WHERE p.DOC_ID = ? AND l.MODE = ? AND l.ERROR IS NULL ORDER BY p.PAGE_INDEX`
const VISUALS_SQL = `SELECT v.PAGE_INDEX, v.VISUAL_ID, v.IMAGE_TYPE, v.SUMMARY, v.VISIBLE_TEXT, v.DETAILS::STRING AS DETAILS
FROM ${DB}.PARSE_VISUALS v JOIN ${DB}.LATEST_RUNS l ON l.RUN_ID = v.RUN_ID
WHERE v.DOC_ID = ? AND l.MODE = 'AGENTIC' AND l.ERROR IS NULL AND NOT v.FAILED ORDER BY v.PAGE_INDEX, v.VISUAL_ID`
const COMPLETE_SQL = `SELECT AI_COMPLETE('${ASK_MODEL}', ?) AS A`

async function askMode(doc: string, mode: AskMode, question: string): Promise<ModeAnswer> {
  const t0 = Date.now()
  const [pages, visuals] = await Promise.all([
    querySnowflake(PAGES_SQL, { binds: [doc, mode] }) as Promise<PageRow[]>,
    mode === "AGENTIC" ? (querySnowflake(VISUALS_SQL, { binds: [doc] }) as Promise<VisualRow[]>) : Promise.resolve([]),
  ])
  if (!pages.length) return { mode, found: false, answer: `No ${mode} parse for this document`, pages: [], ms: Date.now() - t0, noParse: true }
  const pageCount = Math.max(...pages.map((p) => Number(p.PAGE_INDEX) + 1))
  const rows = await querySnowflake(COMPLETE_SQL, { binds: [buildPrompt(question, mode, buildContext(pages, visuals))] })
  return { mode, ...parseAnswer(String(rows[0]?.A ?? ""), pageCount), ms: Date.now() - t0 }
}

export async function POST(req: Request) {
  const refused = guardJsonPost(req)
  if (refused) return refused
  try {
    const body = await req.json().catch(() => null)
    const question = cleanQuestion(body?.question)
    const doc = typeof body?.doc === "string" ? body.doc : ""
    if (!question || !isValidDocId(doc)) return Response.json({ error: "question (1-500 chars) and a valid doc are required" }, { status: 400 })
    const t0 = Date.now()
    const answers = await Promise.all(ASK_MODES.map((m) => askMode(doc, m, question).catch((e): ModeAnswer => {
      console.error(new Date().toISOString(), `[api] ask ${m} failed`, e)
      return { mode: m, found: false, answer: "This mode could not answer (error)", pages: [], ms: Date.now() - t0, error: true }
    })))
    return Response.json({ doc, question, answers, totalMs: Date.now() - t0 })
  } catch (e) {
    return errorResponse(e, "Ask failed")
  }
}
