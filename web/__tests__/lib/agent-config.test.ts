import { describe, expect, it } from "vitest"
import { agentName, agentPath } from "../../lib/agent-config"

describe("agent-config", () => {
  it("defaults to the live demo agent", () => {
    expect(agentName({})).toBe("AGENTIC_PARSE_DEMO_AGENT")
    expect(agentPath({})).toBe("/api/v2/databases/SNOWFLAKE_EXAMPLE/schemas/AGENTIC_PARSE_DEMO/agents/AGENTIC_PARSE_DEMO_AGENT:run")
  })
  it("DEMO_AGENT_NAME points the app at another agent in the same schema", () => {
    expect(agentPath({ DEMO_AGENT_NAME: "AGENTIC_PARSE_DEMO_AGENT_T21_FLOW" })).toContain("/agents/AGENTIC_PARSE_DEMO_AGENT_T21_FLOW:run")
  })
  it("rejects names that are not plain identifiers (no path injection)", () => {
    expect(agentName({ DEMO_AGENT_NAME: "x/../y" })).toBe("AGENTIC_PARSE_DEMO_AGENT")
  })
})
