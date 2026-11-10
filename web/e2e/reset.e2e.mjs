// Presenter controls on the DEPLOYED app: preview badge, presenter questions, status line, Reset demo.
// No billed parse: the upload is stored through /api/upload and never parsed; Reset then removes it.
//   APP_TOKEN_FILE=/tmp/.app_tok node e2e/reset.e2e.mjs
import { appToken } from "./token.mjs"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { BASE, CONN, ROLE, SCHEMA, WH } from "./config.mjs"

const PW = process.env.PLAYWRIGHT_MODULE ?? "playwright"
const { chromium } = await import(PW)
const TOKEN = appToken()
const SHOTS = resolve(import.meta.dirname, "../../docs/screenshots")
const S = SCHEMA
const sql = (q) => JSON.parse(execFileSync("snow", ["sql", "-c", CONN, "--role", ROLE, "--warehouse", WH, "--format", "json", "-q", q], { encoding: "utf8" }))
const assert = (c, m) => { if (!c) throw new Error(m) }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { Authorization: `Snowflake Token="${TOKEN}"` } })
const page = await ctx.newPage()
page.setDefaultTimeout(60_000)
let docId = null
try {
  await page.goto(BASE)
  await page.getByTestId("preview-badge").waitFor()
  assert((await page.getByTestId("preview-badge").textContent()).includes("Public Preview (released 2026-10-28)"), "badge text")
  await page.screenshot({ path: `${SHOTS}/t19-home-badge-reset.png` })
  console.log("ok  home preview badge + reset button")

  const chat = page.getByRole("region", { name: "Demo Agent chat" })
  if (!(await chat.isVisible().catch(() => false))) await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
  await chat.getByRole("button", { name: "Clear" }).click().catch(() => {})
  await chat.getByTestId("presenter-questions").waitFor()
  assert((await chat.getByTestId("presenter-questions").getByRole("button").count()) === 4, "4 presenter chips")
  await page.screenshot({ path: `${SHOTS}/t19-chat-presenter-questions.png` })
  console.log("ok  4 presenter questions")
  await chat.getByTestId("presenter-questions").getByRole("button").nth(3).click() // cost question
  const status = chat.getByTestId("chat-status")
  await status.waitFor()
  await page.waitForTimeout(3500)
  const label = await status.textContent()
  await page.screenshot({ path: `${SHOTS}/t19-chat-status.png` })
  assert(/\d+ s/.test(label) && /…/.test(label), `status line with elapsed seconds: ${label}`)
  await status.waitFor({ state: "detached", timeout: 180_000 })
  console.log(`ok  status line "${label.trim()}"`)

  await page.goto(`${BASE}/documents/quarterly_report`)
  await page.getByRole("tab", { name: "Compare modes" }).click()
  await page.getByTestId("preview-badge").waitFor()
  await page.screenshot({ path: `${SHOTS}/t19-compare-badge.png` })
  console.log("ok  compare view preview badge")

  // A stored, unparsed upload, then Reset through the dialog.
  const up = await page.request.post(`${BASE}/api/upload`, { multipart: { file: { name: "qa_reset_ui.jpg", mimeType: "image/jpeg", buffer: readFileSync(resolve(import.meta.dirname, "../../corpus/receipt_photo.jpg")) } } })
  docId = (await up.json()).doc_id
  assert(docId?.startsWith("up_qa_reset_ui"), "upload stored")
  await page.evaluate(() => { localStorage.setItem("theme", "dark") })
  await page.goto(BASE)
  await page.getByTestId("reset-demo").click()
  await page.getByRole("dialog").waitFor()
  await page.screenshot({ path: `${SHOTS}/t19-reset-dialog.png` })
  await Promise.all([page.waitForEvent("framenavigated", { timeout: 120_000 }), page.getByTestId("reset-demo-confirm").click()])
  await page.waitForLoadState("load")
  await page.getByTestId("preview-badge").waitFor()
  await page.waitForTimeout(1500)
  const left = sql(`SELECT COUNT(*) AS N FROM ${S}.DOCUMENTS WHERE SOURCE = 'upload'`)[0].N
  const files = sql(`LIST @${S}.DOCS/uploads/`).length
  const theme = await page.evaluate(() => [localStorage.getItem("theme"), document.documentElement.classList.contains("dark"), sessionStorage.getItem("agentic-parse-demo:chat")])
  assert(left === 0 && files === 0, `reset left ${left} rows, ${files} files`)
  assert(theme[0] === "light" && theme[1] === false && (theme[2] ?? "[]") === "[]", `after reset ${theme}`)
  docId = null
  console.log(`ok  Reset demo: 0 uploads, 0 stage files, light theme, chat ${theme[2] ?? "(none)"}`)
  console.log("PASS")
} finally {
  if (docId) {
    sql(`REMOVE @${S}.DOCS/uploads/${docId}`)
    for (const t of ["MODE_COMPARISONS", "PARSE_RUNS", "DOCUMENT_FILES", "DOCUMENTS"]) sql(`DELETE FROM ${S}.${t} WHERE DOC_ID = '${docId}'`)
  }
  await browser.close()
}
