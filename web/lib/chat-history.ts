import type { AgentTurn } from "@/lib/agent-stream"

export interface ChatMessage { role: "user" | "assistant"; text: string; turn?: AgentTurn; /** Key into the mode-comparison results. */ askId?: string }

/** Chat history lives in sessionStorage: per browser tab, browser-side only (the server keeps none), the newest MAX finished messages. */
export const CHAT_KEY = "agentic-parse-demo:chat"
/** Per-question "Compare answers" tables, saved with the chat so a restored answer keeps its table. */
export const COMPARE_KEY = "agentic-parse-demo:compare-results"
const MAX = 40

/** Finished messages only; an answer still streaming at reload is dropped with its question. */
export function serializeChat(messages: ChatMessage[]): string {
  const done: ChatMessage[] = []
  for (const m of messages) {
    if (m.role === "assistant" && m.turn && !m.turn.done) {
      if (done.at(-1)?.role === "user") done.pop()
      continue
    }
    done.push(m)
  }
  return JSON.stringify(done.slice(-MAX))
}

/** Messages to send to the agent: a question whose answer failed is dropped with its empty reply, so the next answer does not reply to it. */
export function agentHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    if (m.role === "assistant" && (m.turn?.error || !m.text)) {
      if (out.at(-1)?.role === "user") out.pop()
      continue
    }
    if (m.text) out.push(m)
  }
  return out
}

/** The agent API takes at most 40 messages of 4000 characters (lib/agent-request.ts); a long demo has more.
 *  Keep the newest `max` messages, starting on a user turn, each clipped to fit. */
/** Longest message the chat box accepts; recentForAgent cuts history to the same length so nothing typed is lost silently. */
export const MAX_MESSAGE_CHARS = 3500

export function recentForAgent(messages: ChatMessage[], max = 30, maxChars = MAX_MESSAGE_CHARS): ChatMessage[] {
  let out = messages.slice(-max)
  while (out.length > 1 && out[0].role !== "user") out = out.slice(1)
  return out.map((m) => (m.text.length > maxChars ? { ...m, text: `${m.text.slice(0, maxChars)}…` } : m))
}

export function parseChat(raw: string | null): ChatMessage[] {
  try {
    const v = JSON.parse(raw ?? "[]")
    if (!Array.isArray(v)) return []
    return v.filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.text === "string")
  } catch {
    return []
  }
}

export function loadChat(): ChatMessage[] {
  return typeof sessionStorage === "undefined" ? [] : parseChat(sessionStorage.getItem(CHAT_KEY))
}

export function saveChat(messages: ChatMessage[]): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CHAT_KEY, serializeChat(messages))
}

/** New chat: forget the saved messages and their comparison tables. */
export function clearChatStorage(session: { removeItem(k: string): void }): void {
  session.removeItem(CHAT_KEY)
  session.removeItem(COMPARE_KEY)
}
