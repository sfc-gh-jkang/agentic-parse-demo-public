import crypto from "crypto"
import fs from "fs"
import { getRestApiAuthHeader, getServiceToken, readTomlDefaultConnection } from "@/lib/snowflake"

export interface AgentAuth { authorization: string; tokenType: string }

/**
 * REST auth for agent:run. In a Snowflake App the mounted service token is used (OAUTH).
 * Local dev falls back to SNOWFLAKE_PAT, then to a key-pair JWT from the default connection.
 */
export function getAgentAuth(): AgentAuth {
  if (getServiceToken()) return { authorization: getRestApiAuthHeader(), tokenType: "OAUTH" }
  if (process.env.SNOWFLAKE_PAT) return { authorization: `Bearer ${process.env.SNOWFLAKE_PAT}`, tokenType: "PROGRAMMATIC_ACCESS_TOKEN" }
  const c = readTomlDefaultConnection() as Record<string, any> | null
  const keyPath = c?.private_key_file ?? c?.private_key_path
  if (c?.account && c?.user && keyPath) {
    const priv = crypto.createPrivateKey(fs.readFileSync(keyPath as string))
    const pubDer = crypto.createPublicKey(priv).export({ type: "spki", format: "der" })
    const fp = `SHA256:${crypto.createHash("sha256").update(pubDer).digest("base64")}`
    const acct = String(c.account).toUpperCase().split(".")[0]
    const qual = `${acct}.${String(c.user).toUpperCase()}`
    const now = Math.floor(Date.now() / 1000)
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
    const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: `${qual}.${fp}`, sub: qual, iat: now, exp: now + 3000 })}`
    const sig = crypto.sign("RSA-SHA256", Buffer.from(body), priv).toString("base64url")
    return { authorization: `Bearer ${body}.${sig}`, tokenType: "KEYPAIR_JWT" }
  }
  return { authorization: getRestApiAuthHeader(), tokenType: "OAUTH" }
}
