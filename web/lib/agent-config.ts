const DEFAULT_AGENT = "AGENTIC_PARSE_DEMO_AGENT"

/** The agent the chat calls. DEMO_AGENT_NAME (a plain identifier in the demo schema) lets local dev and the storyline e2e target a temp agent. */
export function agentName(env: Record<string, string | undefined> = process.env): string {
  const n = env.DEMO_AGENT_NAME
  return n && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n.toUpperCase() : DEFAULT_AGENT
}

export function agentPath(env: Record<string, string | undefined> = process.env): string {
  return `/api/v2/databases/SNOWFLAKE_EXAMPLE/schemas/AGENTIC_PARSE_DEMO/agents/${agentName(env)}:run`
}
