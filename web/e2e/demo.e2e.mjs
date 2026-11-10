// End-to-end run of the talk-track path against the DEPLOYED app (no local dev server).
//
// Run (from web/):
//   SNOWFLAKE_PRIVATE_KEY_PATH=~/.snowflake/keys/<key>.p8 uv run --project .. python ../scripts/app_token.py > /tmp/.app_tok
//   APP_TOKEN_FILE=/tmp/.app_tok node e2e/demo.e2e.mjs ; rm /tmp/.app_tok
//
// Spends AI credits: one 1-page AGENTIC parse of a generated PDF. The upload's rows and stage
// file are deleted at the end (snow CLI, connection from config.env), pass or fail.
import { appToken } from "./token.mjs"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { BASE, CONN, ROLE, SCHEMA, WH } from "./config.mjs"

const PW = process.env.PLAYWRIGHT_MODULE ?? "playwright"
const { chromium } = await import(PW)

const TOKEN = appToken()
const SHOTS = resolve(import.meta.dirname, "../../docs/screenshots")
const UPLOAD_NAME = "e2e_fixture.pdf"
mkdirSync(SHOTS, { recursive: true })

/** A valid one-page PDF with a known sentence, built byte-exact so the xref offsets are right. */
function tinyPdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let out = "%PDF-1.4\n"
  const offs = objs.map((o, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  out += offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}

function sql(q) {
  return execFileSync("snow", ["sql", "-c", CONN, "--role", ROLE, "--format", "json", "-q", q], { encoding: "utf8" })
}

function cleanup() {
  const like = "up_e2e_fixture_%"
  sql(
    [
      `USE WAREHOUSE ${WH}`,
      `DELETE FROM ${SCHEMA}.MODE_COMPARISONS WHERE DOC_ID LIKE '${like}'`,
      `DELETE FROM ${SCHEMA}.PARSE_RUNS WHERE DOC_ID LIKE '${like}'`,
      `DELETE FROM ${SCHEMA}.DOCUMENT_FILES WHERE DOC_ID LIKE '${like}'`,
      `DELETE FROM ${SCHEMA}.DOCUMENTS WHERE DOC_ID LIKE '${like}'`,
      `REMOVE @${SCHEMA}.DOCS/uploads/ PATTERN='.*up_e2e_fixture_.*'`,
      `ALTER STAGE ${SCHEMA}.DOCS REFRESH`,
      `ALTER CORTEX SEARCH SERVICE ${SCHEMA}.PARSED_DOCS_SEARCH REFRESH`,
    ].join(";\n"),
  )
}

const steps = []
async function step(name, fn) {
  const t = Date.now()
  await fn()
  steps.push(`${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`)
  console.log(`ok  ${name}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { Authorization: `Snowflake Token="${TOKEN}"` },
})
await ctx.addInitScript(() => localStorage.setItem("agentic-parse-demo:welcomed", "1"))
const page = await ctx.newPage()
page.setDefaultTimeout(60_000)
const chat = page.getByRole("region", { name: "Demo Agent chat" })

async function ask(q, timeout = 240_000) {
  const before = await chat.getByTestId("assistant-message").count()
  await chat.getByLabel("Message the Demo Agent").fill(q)
  await chat.getByRole("button", { name: "Send" }).click()
  const msg = chat.getByTestId("assistant-message").nth(before)
  await msg.waitFor()
  await msg.getByTestId("chat-status").waitFor({ state: "detached", timeout })
  return msg
}

let failed = null
try {
  await step("documents list", async () => {
    await page.goto(BASE)
    await page.locator('a[href="/documents/quarterly_report"]').first().waitFor()
    await page.screenshot({ path: `${SHOTS}/01-documents.png` })
  })

  await step("open quarterly_report, one mode view renders PDF + boxes", async () => {
    await page.goto(`${BASE}/documents/quarterly_report`)
    await page.locator("canvas").first().waitFor()
    await page.getByRole("tab", { name: "One mode" }).click()
    await page.getByRole("tab", { name: "AGENTIC" }).click()
    await page.getByRole("button", { name: /^Visual: / }).first().waitFor()
  })

  await step("chart Visual opens detail below, second click closes it", async () => {
    const chart = page.getByRole("button", { name: /^Visual: .*chart/i }).first()
    await chart.click()
    const detail = page.getByRole("region", { name: "Visual detail" })
    await detail.waitFor()
    await page.screenshot({ path: `${SHOTS}/02-visual-detail.png` })
    await chart.click()
    await detail.waitFor({ state: "detached" })
  })

  await step("Compare modes AGENTIC vs LAYOUT and vs OCR", async () => {
    await page.getByRole("tab", { name: "Compare modes" }).click()
    await page.getByRole("tab", { name: "AGENTIC vs LAYOUT" }).click()
    await page.getByRole("tab", { name: "AGENTIC vs LAYOUT", selected: true }).waitFor()
    await page.screenshot({ path: `${SHOTS}/03-compare-layout.png` })
    await page.getByRole("tab", { name: "AGENTIC vs OCR" }).click()
    await page.getByRole("tab", { name: "AGENTIC vs OCR", selected: true }).waitFor()
  })

  let docId
  await step("upload tiny PDF and Run AGENTIC (billed, 1 page)", async () => {
    await page.goto(BASE)
    for (const m of ["OCR", "LAYOUT"]) await page.getByRole("checkbox", { name: m }).uncheck()
    await page.getByTestId("upload-input").setInputFiles({
      name: UPLOAD_NAME,
      mimeType: "application/pdf",
      buffer: tinyPdf("Northwind e2e invoice total is 4321 dollars, due on 15 November 2026."),
    })
    await page.waitForURL(/\/documents\/up_e2e_fixture_/, { timeout: 420_000 })
    docId = page.url().split("/documents/")[1].split(/[?#]/)[0]
    await page.locator("canvas").first().waitFor()
    await page.screenshot({ path: `${SHOTS}/04-upload-parsed.png` })
  })

  await step("chat asks about the upload and cites it", async () => {
    await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
    // Search refresh after an app parse is asynchronous; retry once if the first answer misses it.
    let msg
    for (let i = 0; i < 3; i++) {
      msg = await ask(`What total amount is stated in the uploaded document ${docId}? Cite it.`)
      const text = await msg.innerText()
      if (/4,?321/.test(text) && (await msg.getByRole("button", { name: new RegExp(docId) }).count()) > 0) break
      if (i === 2) throw new Error(`answer did not cite ${docId}: ${text.slice(0, 400)}`)
      // Say why, so a slow step is diagnosable (search returns the upload within ~1 s of APP_PARSE: QA round 9).
      console.log(`retry ${i + 1}: has 4321=${/4,?321/.test(text)}, cite button=${(await msg.getByRole("button", { name: new RegExp(docId) }).count()) > 0}: ${text.slice(0, 300).replace(/\s+/g, " ")}`)
      await page.waitForTimeout(30_000)
    }
    await page.screenshot({ path: `${SHOTS}/05-chat-upload.png` })
  })

  await step("chat moves viewer to claim_packet page 2, compare vs OCR", async () => {
    await ask("Show me page 2 of claim_packet in compare view against OCR")
    await page.waitForURL(/\/documents\/claim_packet/)
    await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "2", exact: true }).waitFor()
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('[role="group"][aria-label="Page"] button')].find((x) => x.textContent?.trim() === "2")
      return b && b.className.includes("bg-primary")
    })
    await page.getByRole("tab", { name: "Compare modes", selected: true }).waitFor()
    await page.getByRole("tab", { name: "AGENTIC vs OCR", selected: true }).waitFor()
    await page.screenshot({ path: `${SHOTS}/06-agent-navigates.png` })
  })

  await step("value chat: Compare answers across modes, AGENTIC alone answers the diagram question", async () => {
    const toggle = chat.getByLabel("Compare answers across modes")
    if (!(await toggle.isChecked())) await toggle.check()
    const msg = await ask("In floor_plan_diagram, what does Panel P1 connect to, and by what kind of link?")
    const table = msg.getByTestId("compare-table")
    await table.waitFor({ timeout: 120_000 })
    const agentic = await msg.getByTestId("compare-row-AGENTIC").innerText()
    if (!/Rack R1/i.test(agentic) || !/power/i.test(agentic)) throw new Error(`AGENTIC row wrong: ${agentic}`)
    for (const m of ["LAYOUT", "OCR"]) {
      const row = await msg.getByTestId(`compare-row-${m}`).innerText()
      if (/Rack R1/i.test(row)) console.log(`  note: ${m} also answered: ${row.replace(/\s+/g, " ")}`)
    }
    await page.screenshot({ path: `${SHOTS}/07-value-chat.png` })
    await msg.getByTestId("compare-row-AGENTIC").getByRole("button", { name: "p. 1" }).click()
    await page.waitForURL(/\/documents\/floor_plan_diagram/)
  })

  await step("agent drives the app: tour with Next, Back and Esc, then home and upload", async () => {
    await page.goto(`${BASE}/documents/claim_packet`)
    await page.locator('[data-tour="score_strip"]').waitFor()
    if (await page.getByRole("button", { name: "Open Demo Agent chat" }).isVisible()) await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
    await ask("give me a tour of this screen")
    const spot = page.getByTestId("spotlight")
    await spot.waitFor()
    if ((await spot.getAttribute("data-step")) !== "1") throw new Error("tour did not start at step 1")
    await page.getByTestId("spotlight-next").click()
    await page.waitForFunction(() => document.querySelector('[data-testid="spotlight"]')?.getAttribute("data-step") === "2")
    await page.screenshot({ path: `${SHOTS}/08-agent-tour.png` })
    await page.getByTestId("spotlight-back").click()
    await page.keyboard.press("Escape")
    await spot.waitFor({ state: "detached" })
    await ask("take me to upload")
    await page.waitForURL((u) => u.pathname === "/")
    await page.waitForFunction(() => document.querySelector('[data-testid="spotlight"]')?.getAttribute("data-target") === "upload_card")
  })
} catch (e) {
  failed = e
  await page.screenshot({ path: `/tmp/e2e-failure.png` }).catch(() => {})
} finally {
  await browser.close()
  try {
    cleanup()
    console.log("cleanup: upload rows and stage file removed")
  } catch (e) {
    console.error("cleanup FAILED:", e.message)
  }
}

console.log(steps.join("\n"))
if (failed) {
  console.error("FAIL:", failed.message)
  process.exit(1)
}
console.log("PASS")
