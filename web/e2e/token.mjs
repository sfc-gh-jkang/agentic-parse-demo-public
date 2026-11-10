// Ingress token for the deployed app. SNOWFLAKE_PAT (a programmatic access token, environment only) wins: Snowflake
// accepts it directly as `Authorization: Snowflake Token="<pat>"`. Otherwise the OAuth token that
// scripts/app_token.py minted from a key pair, read from APP_TOKEN_FILE (default /tmp/.app_tok).
import { existsSync, readFileSync } from "node:fs"

/** @param {Record<string, string | undefined>} [env] */
export function appToken(env = process.env, read = (f) => readFileSync(f, "utf8"), exists = existsSync) {
  const pat = (env.SNOWFLAKE_PAT ?? "").trim()
  if (pat) return pat
  const file = env.APP_TOKEN_FILE ?? "/tmp/.app_tok"
  if (!exists(file)) throw new Error(`No ingress token: set SNOWFLAKE_PAT, or run scripts/app_token.py > ${file}`)
  const tok = read(file).trim()
  if (!tok) throw new Error(`${file} is empty: set SNOWFLAKE_PAT, or fix the key-pair settings for scripts/app_token.py`)
  return tok
}

/** @param {Record<string, string | undefined>} [env] */
export function authHeaders(env = process.env, read, exists) {
  return { Authorization: `Snowflake Token="${appToken(env, read, exists)}"` }
}

/** Optional variant for scripts that also run locally without auth: {} unless a PAT or APP_TOKEN_FILE is given. */
/** @param {Record<string, string | undefined>} [env] */
export function optionalAuthHeaders(env = process.env) {
  return env.SNOWFLAKE_PAT || env.APP_TOKEN_FILE ? authHeaders(env) : {}
}
