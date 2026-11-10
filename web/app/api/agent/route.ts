import { getSnowflakeBaseUrl } from "@/lib/snowflake"
import { getAgentAuth } from "@/lib/agent-auth"
import { errorResponse, guardJsonPost } from "@/lib/api-utils"
import { agentName, agentPath } from "@/lib/agent-config"
import { validateMessages, type Message } from "@/lib/agent-request"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const sseError = (message: string) =>
  new Response(`event: error\ndata: ${JSON.stringify({ message })}\n\n`, { headers: { "Content-Type": "text/event-stream" } })

/** Which agent this server calls (the storyline e2e asserts it before spending anything). */
export function GET() {
  return Response.json({ agent: agentName() })
}

export async function POST(req: Request) {
  const refused = guardJsonPost(req)
  if (refused) return refused
  let messages: Message[] | null
  try {
    messages = validateMessages(await req.json())
  } catch {
    messages = null
  }
  if (!messages) return Response.json({ error: "Expected messages: [{role, content:[{type:'text', text}]}] ending with a user message" }, { status: 400 })
  try {
    const base = getSnowflakeBaseUrl()
    if (!base) return sseError("No Snowflake account URL configured")
    const auth = getAgentAuth()
    const upstream = await fetch(`${base}${agentPath()}`, {
      method: "POST",
      headers: {
        Authorization: auth.authorization,
        "X-Snowflake-Authorization-Token-Type": auth.tokenType,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ messages, stream: true }),
      signal: req.signal,
    })
    if (!upstream.ok || !upstream.body) {
      const detail = (await upstream.text().catch(() => "")).slice(0, 500)
      console.error(new Date().toISOString(), "[api] agent upstream", upstream.status, detail)
      // The detail stays in the server log: it can carry account, object and request ids.
      return sseError(`Agent request failed (${upstream.status})`)
    }
    return new Response(upstream.body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
    })
  } catch (e) {
    return errorResponse(e, "Agent request failed")
  }
}
