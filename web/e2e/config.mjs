// Deployment names for the e2e scripts: config.env (gitignored) over config.env.example, env vars win.
// Same rule as scripts/demo_config.py.
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "../..")
const parse = (f) =>
  existsSync(f)
    ? Object.fromEntries(
        readFileSync(f, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#") && l.includes("="))
          .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
      )
    : {}

export const CFG = { ...parse(resolve(ROOT, "config.env.example")), ...parse(resolve(ROOT, "config.env")) }
for (const k of Object.keys(CFG)) if (process.env[k]) CFG[k] = process.env[k]
export const CONN = CFG.SNOWFLAKE_CONNECTION
export const ROLE = CFG.DEMO_ROLE
export const WH = CFG.DEMO_WAREHOUSE
export const SCHEMA = `${CFG.DEMO_DATABASE}.${CFG.DEMO_SCHEMA}`
export const BASE = process.env.APP_URL ?? `https://${CFG.APP_HOST}`
if (BASE.includes("<")) throw new Error("Set APP_HOST in config.env (or APP_URL) to the deployed app's host")
