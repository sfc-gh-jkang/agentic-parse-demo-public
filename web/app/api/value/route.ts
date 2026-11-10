import { querySnowflake } from "@/lib/snowflake"
import { errorResponse } from "@/lib/api-utils"
import { parseValueStory } from "@/lib/value"

export const dynamic = "force-dynamic"

// OBJECT_SUFFIX (e.g. _T21) points a local run at scratch copies of the new objects before they are deployed; unset in production.
const SUFFIX = /^[A-Z0-9_]{0,12}$/.test(process.env.OBJECT_SUFFIX ?? "") ? (process.env.OBJECT_SUFFIX ?? "") : ""

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("pages")
  const pages = raw == null ? null : Number(raw)
  if (pages !== null && !(Number.isInteger(pages) && pages >= 1 && pages <= 1_000_000_000)) {
    return Response.json({ error: "pages must be a whole number from 1 to 1,000,000,000" }, { status: 400 })
  }
  try {
    const rows = await querySnowflake(`CALL SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.VALUE_STORY${SUFFIX}(?)`, { binds: [pages] })
    const text = Object.values(rows[0] ?? {})[0]
    const story = parseValueStory(typeof text === "string" ? JSON.parse(text) : text)
    if (!story) return Response.json({ error: "No scored Documents with measured cost yet" }, { status: 404 })
    return Response.json(story)
  } catch (e) {
    return errorResponse(e, "Failed to load the value story")
  }
}
