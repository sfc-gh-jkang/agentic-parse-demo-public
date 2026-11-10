const MAX_MESSAGES = 40
const MAX_CHARS = 4000

export interface Message { role: "user" | "assistant"; content: { type: "text"; text: string }[] }

export function validateMessages(body: unknown): Message[] | null {
  const msgs = (body as { messages?: unknown })?.messages
  if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > MAX_MESSAGES) return null
  const out: Message[] = []
  for (const m of msgs) {
    const role = (m as any)?.role
    const parts = (m as any)?.content
    if ((role !== "user" && role !== "assistant") || !Array.isArray(parts) || parts.length === 0) return null
    const content = parts.map((p: any) => (p?.type === "text" && typeof p.text === "string" && p.text.length <= MAX_CHARS ? { type: "text" as const, text: p.text } : null))
    if (content.some((c: unknown) => c === null)) return null
    out.push({ role, content: content as Message["content"] })
  }
  const last = out[out.length - 1]
  return last.role === "user" && last.content.some((c) => c.text.trim()) ? out : null
}
