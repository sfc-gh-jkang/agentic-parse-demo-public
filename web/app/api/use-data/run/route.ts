import { querySnowflake } from "@/lib/snowflake"
import { errorResponse, guardJsonPost, isValidDocId } from "@/lib/api-utils"
import { approxTokens, runnableSql, SNIPPETS, withSuffix, renderSnippet } from "@/lib/use-data"

export const dynamic = "force-dynamic"

// Metered AI_EXTRACT usage on this account (the same history view PARSE_COST reads): the only source of a rate, since the
// Snowflake pricing page gives none ("AI Credits per million tokens, rate varies by model").
const USAGE_SQL = `SELECT COUNT(DISTINCT u.QUERY_ID) AS CALLS, SUM(m.value:value::NUMBER) AS TOKENS, SUM(u.CREDITS) AS CREDITS
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY u, LATERAL FLATTEN(u.METRICS) m
WHERE u.FUNCTION_NAME = 'AI_EXTRACT' AND u.IS_COMPLETED AND m.value:key:metric::STRING = 'total'
  AND u.START_TIME >= DATEADD(day, -30, CURRENT_TIMESTAMP())`

async function measuredRate(): Promise<{ calls: number; tokens: number; creditsPerMillionTokens: number } | null> {
  try {
    const r = (await querySnowflake(USAGE_SQL))[0]
    const tokens = Number(r?.TOKENS), credits = Number(r?.CREDITS)
    return tokens > 0 && Number.isFinite(credits) ? { calls: Number(r.CALLS), tokens, creditsPerMillionTokens: (credits / tokens) * 1e6 } : null
  } catch {
    return null
  }
}

const SUFFIX = /^[A-Z0-9_]{0,12}$/.test(process.env.OBJECT_SUFFIX ?? "") ? (process.env.OBJECT_SUFFIX ?? "") : ""

/**
 * Runs one allowlisted snippet for one Document. No SQL comes from the caller: the body names a snippet id and a Document id,
 * the text is fixed in lib/use-data-snippets.json and the Document id is checked against ^[a-z0-9_]{1,64}$.
 * Billed snippets (AI_EXTRACT) refuse to run without confirm=true; confirm=false returns their size instead (nothing billed).
 */
export async function POST(req: Request) {
  const refused = guardJsonPost(req)
  if (refused) return refused
  const body = (await req.json().catch(() => null)) as { snippet?: unknown; doc?: unknown; confirm?: unknown } | null
  const id = typeof body?.snippet === "string" ? body.snippet : ""
  const doc = typeof body?.doc === "string" ? body.doc : ""
  if (!isValidDocId(doc)) return Response.json({ error: "Invalid document id" }, { status: 400 })
  const run = runnableSql(id, doc, SUFFIX)
  if (!run) return Response.json({ error: "Unknown or non-runnable snippet" }, { status: 400 })
  try {
    if (run.snippet.kind === "billed" && body?.confirm !== true) {
      const input = SNIPPETS.find((s) => s.id === id)!.input_sql!
      const rows = await querySnowflake(withSuffix(renderSnippet(input, doc)!, SUFFIX))
      const chars = String(rows[0]?.CONTENT ?? "").length
      const tokens = approxTokens(chars)
      const rate = await measuredRate()
      return Response.json({
        needsConfirm: true, inputChars: chars, approxInputTokens: tokens, measuredRate: rate,
        estimatedCredits: rate ? (tokens * rate.creditsPerMillionTokens) / 1e6 : null,
      })
    }
    const rows = await querySnowflake(run.sql)
    return Response.json({ columns: Object.keys(rows[0] ?? {}), rows: rows.slice(0, 50), billed: run.snippet.kind === "billed" })
  } catch (e) {
    return errorResponse(e, "Failed to run the snippet")
  }
}
