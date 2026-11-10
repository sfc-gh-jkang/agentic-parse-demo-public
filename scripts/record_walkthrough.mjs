// Offline fallback: record the talk-track path on the DEPLOYED app as a video plus numbered stills.
// No billed parse (the upload step is shown, not run); the agent answers one presenter question and
// gives a tour (agent usage only). Output: docs/walkthrough/walkthrough.webm + NN-*.png.
//
//   SNOWFLAKE_PRIVATE_KEY_PATH=~/.snowflake/keys/<key>.p8 uv run python scripts/app_token.py > /tmp/.app_tok
//   APP_TOKEN_FILE=/tmp/.app_tok node scripts/record_walkthrough.mjs ; rm /tmp/.app_tok
import { appToken } from "../web/e2e/token.mjs"
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { BASE, CONN, ROLE, SCHEMA, WH } from "../web/e2e/config.mjs"

const PW = process.env.PLAYWRIGHT_MODULE ?? new URL("../web/node_modules/playwright/index.mjs", import.meta.url).href
const { chromium } = await import(PW)
const TOKEN = appToken()
const OUT = resolve(import.meta.dirname, "../docs/walkthrough")
const SIZE = { width: 1280, height: 800 }
const MAX_MS = 180_000
rmSync(OUT, { recursive: true, force: true })
mkdirSync(`${OUT}/raw`, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: SIZE,
  recordVideo: { dir: `${OUT}/raw`, size: SIZE },
  extraHTTPHeaders: { Authorization: `Snowflake Token="${TOKEN}"` },
})
// Skip the first-visit welcome dialog (it would cover the page), as web/e2e/demo.e2e.mjs does.
await ctx.addInitScript(() => localStorage.setItem("agentic-parse-demo:welcomed", "1"))
const page = await ctx.newPage()
page.setDefaultTimeout(60_000)
const t0 = Date.now()
let n = 0
const still = async (name) => page.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png` })
const pause = (ms) => page.waitForTimeout(ms)
const chat = page.getByRole("region", { name: "Demo Agent chat" })

try {
  await page.goto(BASE)
  await page.locator('a[href="/documents/quarterly_report"]').first().waitFor()
  await pause(2500)
  await still("home-cost-and-documents")

  await page.goto(`${BASE}/documents/quarterly_report`)
  await page.locator("canvas").first().waitFor()
  await page.getByRole("tab", { name: "One mode" }).click()
  await page.getByRole("tab", { name: "AGENTIC" }).click()
  const chart = page.getByRole("button", { name: /^Visual: .*chart/i }).first()
  await chart.waitFor()
  await pause(1500)
  await chart.click()
  await page.getByRole("region", { name: "Visual detail" }).waitFor()
  await pause(3000)
  await still("agentic-chart-detail")
  await chart.click()
  for (const m of ["LAYOUT", "OCR"]) {
    await page.getByRole("tab", { name: m }).click()
    await pause(2000)
  }
  await still("ocr-one-mode")

  await page.getByRole("tab", { name: "Compare modes" }).click()
  await page.getByRole("tab", { name: "AGENTIC vs LAYOUT" }).click()
  await pause(3000)
  await still("compare-agentic-vs-layout")
  await page.getByRole("tab", { name: "AGENTIC vs OCR" }).click()
  await pause(2500)
  await still("compare-agentic-vs-ocr")

  await page.goto(`${BASE}/documents/claim_packet`)
  await page.locator("canvas").first().waitFor()
  await page.getByText("What was missed").click()
  await pause(3000)
  await still("claim-packet-what-was-missed")

  // Chat: one rehearsed presenter question (agent answers + compare table), then a tour.
  if (!(await chat.isVisible().catch(() => false))) await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
  const ask = async (q, timeout = 150_000) => {
    const before = await chat.getByTestId("assistant-message").count()
    await chat.getByLabel("Message the Demo Agent").fill(q)
    await chat.getByRole("button", { name: "Send" }).click()
    const msg = chat.getByTestId("assistant-message").nth(before)
    await msg.getByTestId("chat-status").waitFor({ timeout: 30_000 }).catch(() => {})
    await still("agent-working-status")
    await msg.getByTestId("chat-status").waitFor({ state: "detached", timeout })
    return msg
  }
  await page.goto(`${BASE}/documents/quarterly_report`)
  await page.locator("canvas").first().waitFor()
  if (!(await chat.isVisible().catch(() => false))) await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
  await ask("In quarterly_report, what was Q3 revenue on the revenue chart?")
  await pause(6000) // compare-answers table fills in
  await still("agent-answer-q3-revenue")
  if (Date.now() - t0 < MAX_MS - 60_000) {
    await ask("give me a tour of this page")
    const spot = page.getByTestId("spotlight")
    await spot.waitFor({ timeout: 15_000 }).catch(() => {})
    for (let i = 0; i < 3 && (await page.getByTestId("spotlight-next").isVisible().catch(() => false)); i++) {
      await pause(2500)
      if (i === 0) await still("tour-step")
      await page.getByTestId("spotlight-next").click()
    }
    await page.keyboard.press("Escape")
  }
  await pause(1500)
} finally {
  await ctx.close()
  await browser.close()
}

const raw = readdirSync(`${OUT}/raw`).find((f) => f.endsWith(".webm"))
renameSync(`${OUT}/raw/${raw}`, `${OUT}/walkthrough.webm`)
rmSync(`${OUT}/raw`, { recursive: true, force: true })
const mb = statSync(`${OUT}/walkthrough.webm`).size / 1e6
console.log(`walkthrough.webm ${mb.toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s, ${n} stills in ${OUT}`)
