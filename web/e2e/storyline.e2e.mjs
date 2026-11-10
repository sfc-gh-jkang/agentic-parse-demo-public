// The whole talk track (docs/talk-track.md) as ONE continuous browser session, beat by beat, against any agent.
// Each beat: do the click/ask, assert the screen state and the answer, screenshot, record seconds to first token and done.
//
// Local (no deploy): start the app on a temp agent, then run this:
//   uv run python scripts/temp_agent.py create
//   (cd web && DEMO_AGENT_NAME=AGENTIC_PARSE_DEMO_AGENT_T21_FLOW SNOWFLAKE_CONNECTION_NAME=<your-connection> npm run dev)
//   (cd web && AGENT_NAME=AGENTIC_PARSE_DEMO_AGENT_T21_FLOW node e2e/storyline.e2e.mjs)
//   uv run python scripts/temp_agent.py drop
// Env: APP_URL (default http://localhost:3000), AGENT_NAME (asserted against GET /api/agent before anything is asked),
//   OUT_DIR (default /tmp/t21-flow), APP_TOKEN_FILE (deployed app only), CONFIRM_REPARSE=1 (really run the billed
//   1-page AGENTIC reparse; default declines), CONFIRM_BILLED=1 (confirm and run the billed AI_EXTRACT snippet in the
//   Use this data tab; default cancels at the confirm step). The upload step only checks the control (no upload is made).
// Exit 1 if any beat fails. Writes OUT_DIR/NN-beat.png and OUT_DIR/flow.json.
import { optionalAuthHeaders } from "./token.mjs"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const PW = process.env.PLAYWRIGHT_MODULE ?? "playwright"
const { chromium } = await import(PW)
const BASE = process.env.APP_URL ?? "http://localhost:3000"
const OUT = process.env.OUT_DIR ?? "/tmp/t21-flow"
const CONFIRM = process.env.CONFIRM_REPARSE === "1"
const CONFIRM_BILLED = process.env.CONFIRM_BILLED === "1"
mkdirSync(OUT, { recursive: true })

const PAYOFF = "In quarterly_report, what was Q3 revenue on the revenue chart?"
const VALUE = "Why does AGENTIC matter, and is it worth the cost?"
const REVIEW = "If review takes 5 minutes a page at $60/hour, what does 50,000 pages a month cost?"
const DATA = "Compare Q3 revenue across the reports."
const TRAP = "What was the stamped invoice's total in Japanese yen, and how many credits did the 2025 parse runs use?"
const REPARSE = "Re-parse receipt_photo in AGENTIC mode."
const HEADLINE =
  "Which Document does AGENTIC beat LAYOUT on by the most Facts inside images? Show me its scores first, then find the page where those Facts are, and highlight the result on screen."

const headers = optionalAuthHeaders()
if (process.env.AGENT_NAME) {
  const r = await fetch(`${BASE}/api/agent`, { headers })
  const got = (await r.json()).agent
  if (got !== process.env.AGENT_NAME.toUpperCase()) {
    console.error(`REFUSING: app calls ${got}, expected ${process.env.AGENT_NAME}. Start next dev with DEMO_AGENT_NAME=${process.env.AGENT_NAME}.`)
    process.exit(2)
  }
}

// Warm the app: an idle dev server can take 30 s+ to answer its first request, which would fail beat 0 for the wrong reason.
for (const u of ["/", "/documents/quarterly_report", "/api/value", "/api/cost", "/api/documents"]) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(BASE + u, { headers, signal: AbortSignal.timeout(60_000) })
      if (r.ok) break
    } catch {}
  }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: headers })
// A presenter has dismissed the first-visit welcome already (e2e/onboarding.e2e.mjs covers it).
await ctx.addInitScript(() => localStorage.setItem("agentic-parse-demo:welcomed", "1"))
const page = await ctx.newPage()
page.setDefaultTimeout(30_000)
const chat = page.getByRole("region", { name: "Demo Agent chat" })
const results = []
let n = 0
let lastAnswerText = ""

const shot = async (name) => {
  n += 1
  const path = `${OUT}/${String(n).padStart(2, "0")}-${name}.png`
  await page.screenshot({ path })
  return path
}
const lastAnswer = () => chat.getByTestId("assistant-message").last()
const answerText = async () => (await lastAnswer().innerText()).replace(/\s+/g, " ")

/** Sends a chip or typed message and waits for the answer. Returns {first, done} seconds from the click. */
async function ask({ chip, typed }) {
  const before = await chat.getByTestId("assistant-message").count()
  // The stream keeps closing for a few seconds after the answer is complete (suggested queries); the box re-enables then.
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Message the Demo Agent"], input[aria-label="Message the Demo Agent"]')?.disabled)
  const t0 = Date.now()
  if (chip) {
    // After the first message the chips live under a collapsed "Presenter questions" row, as for a presenter.
    const later = chat.getByTestId("presenter-later")
    if ((await later.count()) && !(await later.evaluate((d) => d.open))) await later.locator("summary").click()
    await chat.getByRole("button", { name: chip, exact: true }).click()
  }
  else {
    await chat.getByRole("textbox", { name: "Message the Demo Agent" }).fill(typed)
    await chat.getByRole("button", { name: "Send" }).click()
  }
  await page.waitForFunction((b) => document.querySelectorAll('[data-testid="assistant-message"]').length > b, before)
  let first = null
  // Poll with count()/textContent, never innerText(): innerText waits the full default timeout for a missing element,
  // which once added up to 30 s of phantom latency to every "done" reading.
  for (;;) {
    if (Date.now() - t0 > 150_000) throw new Error("answer not done after 150 s")
    const status = chat.getByTestId("chat-status")
    const waiting = (await status.count()) > 0
    if (first === null && (!waiting || /Writing the answer/.test((await status.first().textContent().catch(() => "")) ?? ""))) first = (Date.now() - t0) / 1000
    if (!waiting) break
    await page.waitForTimeout(150)
  }
  lastAnswerText = await answerText()
  return { first: first ?? (Date.now() - t0) / 1000, done: (Date.now() - t0) / 1000 }
}

async function beat(name, fn) {
  const row = { beat: name, pass: false, first: null, done: null, shot: null, notes: [], answer: "" }
  lastAnswerText = ""
  const t = Date.now()
  try {
    const timing = (await fn(row)) ?? {}
    row.first = timing.first ?? null
    row.done = timing.done ?? (Date.now() - t) / 1000
    row.pass = true
  } catch (e) {
    row.notes.push(`FAIL: ${String(e.message).split("\n")[0]}`)
    const status = (await chat.getByTestId("chat-status").count()) ? "waiting" : "none"
    row.notes.push(`url=${path()} chat-status=${status} boxes=${await page.locator('[data-tour="visual_box"]').count()} detail=${await page.locator('[data-tour="visual_detail"]').count()}`)
    row.done = (Date.now() - t) / 1000
  }
  row.answer = lastAnswerText.slice(0, 700)
  row.shot = await shot(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${row.pass ? "" : "-FAILED"}`)
  results.push(row)
  console.log(`${row.pass ? "PASS" : "FAIL"} ${name} first=${row.first?.toFixed(1) ?? "-"}s done=${row.done.toFixed(1)}s ${row.notes.join("; ")}`)
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
const path = () => new URL(page.url()).pathname

/** The element is on screen for a viewer: mostly inside the viewport and not covered by another element. */
async function visible(loc, what) {
  // The page may still be settling (route change, scroll, animation): retry for ~3 s before failing.
  let last
  for (let i = 0; i < 15; i++) {
    try {
      return await visibleOnce(loc, what)
    } catch (e) {
      last = e
      await page.waitForTimeout(200)
    }
  }
  throw last
}
async function visibleOnce(loc, what) {
  const el = loc.first()
  await el.waitFor({ state: "visible" })
  const r = await el.evaluate((e) => {
    const b = e.getBoundingClientRect()
    // Visible box = the element's box clipped by the viewport and by every scrolling/clipping ancestor.
    let L = Math.max(b.left, 0), T = Math.max(b.top, 0), R = Math.min(b.right, innerWidth), B = Math.min(b.bottom, innerHeight)
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a)
      if (/(auto|scroll|hidden|clip)/.test(o.overflowX + o.overflowY)) {
        const c = a.getBoundingClientRect()
        L = Math.max(L, c.left); T = Math.max(T, c.top); R = Math.min(R, c.right); B = Math.min(B, c.bottom)
      }
    }
    const w = R - L
    const h = B - T
    const cx = L + w / 2
    const cy = T + Math.min(h, 40) / 2
    const top = w > 0 && h > 0 ? document.elementFromPoint(cx, cy) : null
    return { w, h, bw: b.width, bh: b.height, inView: w >= Math.min(b.width, 80) && h >= Math.min(b.height, 24), covered: !(top && (e.contains(top) || top.contains(e))), by: top ? `${top.tagName}.${String(top.className).slice(0, 60)}[${top.getAttribute('data-testid') ?? ''}] "${(top.textContent ?? '').slice(0, 40)}"` : 'nothing' }
  })
  expect(r.inView, `${what} is not in the viewport (visible ${Math.round(r.w)}x${Math.round(r.h)} of ${Math.round(r.bw)}x${Math.round(r.bh)})`)
  expect(!r.covered, `${what} is covered by ${r.by}`)
}

await page.goto(BASE + "/")

await beat("0 setup", async (row) => {
  await page.locator('a[href="/documents/quarterly_report"]').click()
  await page.waitForURL(/documents\/quarterly_report/)
  await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
  const chips = (await chat.getByTestId("presenter-questions").getByRole("button").allInnerTexts()).map((s) => s.trim())
  row.notes.push(`${chips.length} chips`)
  expect(chips.length === 8, `expected 8 chips, got ${chips.length}`)
  expect(chips[0] === PAYOFF, "chip 1 is not the payoff question")
  expect(chips[1] === VALUE, "chip 2 is not the value question")
  expect(chips[2] === REVIEW, "chip 3 is not the review-cost question")
  expect(chips[3] === HEADLINE, "chip 4 is not the headline")
  expect(chips[4] === TRAP, "chip 5 is not the trap question")
  expect(chips[5] === REPARSE, "chip 6 is not the reparse request")
  expect(chips[6] === DATA, "chip 7 is not the data question")
  expect(chips[7] === "Show eval results", "chip 8 is not Show eval results")
  expect(!chips.some((c) => /Panel P1/.test(c)), "Panel P1 duplicate chip is back")
  await visible(chat.getByTestId("presenter-questions").getByRole("button").first(), "first presenter chip")
  const toggle = chat.getByRole("checkbox", { name: "Compare answers across modes" })
  expect(await toggle.isChecked(), "Compare answers should be on by default")
})

await beat("1 opening payoff", async (row) => {
  const timing = await ask({ chip: PAYOFF })
  const text = await answerText()
  expect(/13\.8/.test(text), `answer lacks 13.8: ${text.slice(0, 160)}`)
  expect(/quarterly_report/.test(text) || /p\.\s*1|page 1/i.test(text), "no citation to quarterly_report page 1")
  await chat.getByTestId("compare-table").waitFor()
  const agentic = await chat.getByTestId("compare-row-AGENTIC").innerText()
  const layout = await chat.getByTestId("compare-row-LAYOUT").innerText()
  const ocr = await chat.getByTestId("compare-row-OCR").innerText()
  expect(/13\.8/.test(agentic), `AGENTIC row lacks 13.8: ${agentic}`)
  expect(/Not found/.test(layout) && /Not found/.test(ocr), `LAYOUT/OCR should say Not found: ${layout} | ${ocr}`)
  await visible(chat.getByTestId("compare-row-AGENTIC"), "AGENTIC compare row")
  await visible(chat.getByTestId("compare-row-LAYOUT"), "LAYOUT compare row")
  await visible(chat.getByTestId("compare-row-OCR"), "OCR compare row")
  await visible(lastAnswer(), "the agent answer")
  row.notes.push("AGENTIC 13.8, LAYOUT/OCR Not found")
  // The agent follows its own evidence: after the payoff answer it has already selected the chart, so the detail is open.
  await page.locator('[data-tour="visual_detail"]').waitFor()
  await visible(page.locator('[data-tour="visual_detail"]'), "chart detail")
  row.notes.push("chart detail already open (agent selected it)")
  await shot("chart-detail")
  return timing
})

await beat("1b value beat", async (row) => {
  const timing = await ask({ chip: VALUE })
  const text = await answerText()
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 })
  const card = page.getByTestId("spotlight")
  await card.waitFor({ timeout: 20_000 })
  expect((await card.getAttribute("data-target")) === "value_panel", `spotlight is on ${await card.getAttribute("data-target")}, expected value_panel`)
  await page.getByTestId("value-table").waitFor()
  await visible(page.getByTestId("value-table"), "value table")
  await visible(card, "spotlight card")
  await visible(lastAnswer(), "the agent answer")
  // The panel and the answer carry the same stored numbers: the AGENTIC cost per correct fact on screen is in the answer.
  const cp = (await page.getByTestId("cpcf-AGENTIC").innerText()).trim()
  const ocr = (await page.getByTestId("cpcf-OCR").innerText()).trim()
  expect(/per correct fact/i.test(text), "answer does not say cost per correct fact")
  expect(/8\.18/.test(text), "answer lacks AGENTIC 8.18 credits per 1000 pages")
  expect(/control/i.test(text) && /route|routing/i.test(text), "answer lacks the control Document caveat or the routing recommendation")
  expect(/OCR/.test(text) && /cheaper|less|lowest|cheapest/i.test(text), "answer does not admit OCR is cheaper per fact")
  expect(parseFloat(ocr) < parseFloat(cp), `panel: OCR ${ocr} should be below AGENTIC ${cp} per correct fact`)
  const lead = (s) => s.replace(/^0\.0*/, "").slice(0, 2)
  expect(text.replace(/,/g, "").includes(cp.slice(0, 5)) || text.includes(lead(cp)), `answer does not carry the panel's AGENTIC figure ${cp}`)
  await page.getByTestId("value-derivation").locator("summary").click()
  await visible(page.getByTestId("value-derivation"), "derivation")
  expect(/credits per correct fact/.test(await page.getByTestId("value-derivation").innerText()), "derivation text missing")
  await shot("value-derivation-open")
  await page.getByTestId("value-derivation").locator("summary").click()
  row.notes.push(`panel cost per correct fact AGENTIC ${cp}, OCR ${ocr}; spotlight on value_panel`)
  return timing
})

await beat("1c review cost", async (row) => {
  const timing = await ask({ chip: REVIEW })
  const text = await answerText()
  await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 })
  await page.getByTestId("volume-result").waitFor({ timeout: 20_000 })
  // The agent filled in the user's assumptions: the inputs show them and the panel carries the same figures as the answer.
  expect((await page.getByTestId("volume-input").inputValue()).replace(/,/g, "") === "50000", "volume box is not 50,000")
  expect((await page.getByTestId("review-minutes").inputValue()) === "5", "minutes box is not 5")
  expect((await page.getByTestId("hourly-rate").inputValue()) === "60", "hourly rate box is not 60")
  expect((await page.getByTestId("credit-price").inputValue()) === "", "price per credit must stay empty (the user gave none)")
  const hours = async (m) => (await page.getByTestId(`review-hours-${m}`).innerText()).replace(/,/g, "")
  const cost = async (m) => (await page.getByTestId(`review-cost-${m}`).innerText()).replace(/,/g, "")
  expect((await hours("AGENTIC")) === "1042" && (await hours("OCR")) === "2604", `panel hours AGENTIC ${await hours("AGENTIC")} OCR ${await hours("OCR")}`)
  expect((await cost("AGENTIC")) === "62500" && (await cost("OCR")) === "156250", `panel cost AGENTIC ${await cost("AGENTIC")} OCR ${await cost("OCR")}`)
  expect((await page.getByTestId("month-credits-AGENTIC").innerText()).trim() === "409", "AGENTIC credits per month is not 409")
  expect(await page.getByTestId("ai-cost-AGENTIC").count() === 0, "credits were turned into money without a price per credit")
  const flat = text.replace(/,/g, "")
  expect(/1042|1041/.test(flat) && /2604|2603/.test(flat), `answer lacks review hours 1,042 / 2,604: ${text.slice(0, 200)}`)
  expect(/62500/.test(flat) && /156250/.test(flat), "answer lacks review cost 62,500 / 156,250")
  expect(/assum/i.test(text), "answer does not call these the user's assumptions")
  expect(!/\$\s?409\b/.test(text), "answer priced the credits in dollars")
  await visible(page.getByTestId("review-assumptions"), "review assumptions")
  await visible(page.getByTestId("hours-saved"), "hours saved line")
  await visible(page.getByTestId("spotlight"), "spotlight card")
  await visible(lastAnswer(), "the agent answer")
  await shot("review-cost")
  row.notes.push("inputs 50,000 / 5 / 60; panel and answer agree: AGENTIC 1,042 h / 62,500, OCR 2,604 h / 156,250; credits stay credits")
  return timing
})

await beat("2 chart and score strip", async (row) => {
  // The value beat left the screen on the home page; open the Document again and click the amber chart box.
  await page.getByTestId("spotlight-close").click().catch(() => {})
  await page.locator('a[href="/documents/quarterly_report"]').click()
  await page.waitForURL(/documents\/quarterly_report/)
  const box = page.locator('[data-tour="visual_box"]').first()
  await box.waitFor()
  await box.click()
  await page.locator('[data-tour="visual_detail"]').waitFor()
  await visible(page.locator('[data-tour="visual_detail"]'), "chart detail")
  await box.click()
  await page.locator('[data-tour="visual_detail"]').waitFor({ state: "detached" })
  const strip = (await page.locator('[data-tour="score_strip"]').innerText()).replace(/\s+/g, " ")
  expect(/Relations/i.test(strip) && /AGENTIC/.test(strip), `score strip: ${strip.slice(0, 200)}`)
  await visible(page.locator('[data-tour="score_strip"]'), "score strip")
  row.notes.push(strip.slice(0, 400))
})

await beat("3 multi-step goal", async (row) => {
  await page.locator('a[href="/"]').first().click()
  await page.waitForURL((u) => u.pathname === "/")
  const timing = await ask({ chip: HEADLINE })
  const text = await answerText()
  expect(/quarterly_report/.test(text), `answer does not name quarterly_report: ${text.slice(0, 200)}`)
  await page.waitForURL(/documents\/quarterly_report/, { timeout: 20_000 })
  await page.getByTestId("spotlight").waitFor({ timeout: 20_000 })
  await visible(page.getByTestId("spotlight"), "spotlight card")
  await visible(page.getByTestId("spotlight-caption"), "spotlight caption")
  await visible(lastAnswer(), "the agent answer")
  await page.waitForTimeout(800) // the chat scrolls to the end after the suggested queries land; one run saw the header 6 px clipped mid-scroll
  const how = chat.getByTestId("how-i-answered").last()
  expect(await how.evaluate((d) => !d.open), "How I answered should be collapsed by default")
  // A long answer pushes the header above a 360 px viewport once the chat scrolls to the end
  // (seen on a second account: 87 px above). A phone user scrolls up to it; so do we.
  await how.locator("summary").scrollIntoViewIfNeeded()
  await visible(how.locator("summary"), "How I answered header")
  await how.locator("summary").click()
  await visible(how.locator("ol"), "How I answered steps")
  const steps = (await how.innerText()).replace(/\s+/g, " ")
  const order = ["scores and counts", "Mode scored", "Searched the parsed pages", "Moved or highlighted"].map((s) => steps.indexOf(s))
  expect(order.every((i) => i >= 0) && order.join() === [...order].sort((a, b) => a - b).join(), `How I answered order wrong: ${order} in ${steps.slice(0, 300)}`)
  row.notes.push(`steps order ok; app moved to ${path()}, spotlight on`)
  await shot("how-i-answered-open")
  await how.locator("summary").click()
  return timing
})

await beat("4 limits", async (row) => {
  await page.getByTestId("spotlight-close").click().catch(() => {})
  const timing = await ask({ chip: TRAP })
  const text = await answerText()
  expect(!/¥\s?\d|\d[\d,]*\s?(yen|JPY)/i.test(text), `invented a yen figure: ${text.slice(0, 200)}`)
  expect(/not|no |n't|cannot|unable/i.test(text), `no refusal wording: ${text.slice(0, 200)}`)
  await visible(lastAnswer(), "the trap answer")
  await page.locator('a[href="/"]').first().click()
  await page.locator('a[href="/documents/claim_packet"]').click()
  await page.waitForURL(/documents\/claim_packet/)
  await page.locator("summary", { hasText: "What was missed" }).click()
  await page.getByTestId("missed-AGENTIC").waitFor()
  await visible(page.getByTestId("missed-AGENTIC"), "What was missed list")
  await shot("what-was-missed")
  await page.locator('a[href="/"]').first().click()
  await page.locator('a[href="/documents/control_contract"]').click()
  await page.waitForURL(/documents\/control_contract/)
  await page.getByRole("tablist", { name: "View" }).getByRole("tab", { name: "Compare modes" }).click()
  await page.getByRole("tablist", { name: "Compare" }).getByRole("tab", { name: "LAYOUT" }).click()
  await page.locator('[data-tour="score_strip"]').getByText(/Relations found/).first().waitFor()
  await visible(page.locator('[data-tour="score_strip"]'), "control document score strip")
  const strip = (await page.locator('[data-tour="score_strip"]').innerText()).replace(/\s+/g, " ")
  row.notes.push(`control doc strip: ${strip.slice(0, 200)}`)
  return timing
})

await beat("5 reparse asks first", async (row) => {
  const timing = await ask({ chip: REPARSE })
  const text = await answerText()
  expect(await chat.getByRole("alert").count() === 0, "billed-parse banner shown before confirmation")
  expect(path() === "/documents/receipt_photo", `the screen should be on receipt_photo at the cost prompt, it is on ${path()}`)
  await visible(page.locator('[data-tour="document_page"]').first(), "receipt_photo page")
  await visible(lastAnswer(), "the cost prompt")
  expect(/\b(1|one)[- ]pages?\b|\bpages?\W{0,6}(1|one)\b/i.test(text), `no page count: ${text.slice(0, 240)}`)
  expect(/\d+(\.\d+)?\s*(AI )?credits/i.test(text), `no credit sum: ${text.slice(0, 240)}`)
  expect(/\byes\b/i.test(text), "does not ask for yes")
  const tools = await chat.getByTestId("assistant-message").last().locator("span, div").filter({ hasText: /^reparse$/ }).count()
  expect(tools === 0, "reparse tool already ran")
  row.notes.push(text.slice(0, 200))
  await shot("reparse-asks")
  if (CONFIRM) {
    const t2 = await ask({ typed: "yes" })
    await chat.getByRole("alert").first().waitFor({ timeout: 5_000 }).catch(() => {})
    await page.waitForURL(/documents\/receipt_photo/, { timeout: 60_000 })
    await page.locator('[data-tour="cached_label"]').filter({ hasText: "Live Result" }).first().waitFor()
    row.notes.push(`CONFIRMED live reparse in ${t2.done.toFixed(1)}s (billed ~0.008 AI credits)`)
  } else {
    const t2 = await ask({ typed: "no" })
    const reply = await answerText()
    expect(/cancel|not re-?pars|won.t|no problem|understood|ok(ay)?/i.test(reply), `unclear cancel reply: ${reply.slice(0, 200)}`)
    expect((await page.locator('[data-tour="cached_label"]').filter({ hasText: "Live Result" }).count()) === 0, "declined reparse still produced a Live Result badge")
    row.notes.push(`declined; cancel reply in ${t2.done.toFixed(1)}s, nothing billed`)
  }
  return timing
})

await beat("6 eval results", async (row) => {
  await page.locator('a[href="/"]').first().click()
  await page.getByRole("button", { name: "Eval results", exact: true }).click()
  const panel = chat.getByTestId("eval-panel")
  await panel.waitFor()
  const t = (await panel.innerText()).replace(/\s+/g, " ")
  await visible(panel, "eval results panel")
  await visible(panel.getByText(/Agent eval, run \d{4}-\d{2}-\d{2}/), "eval run date")
  await visible(panel.getByText("multi_step_headline").first(), "tool-order row")
  await visible(panel.getByText(/claude-sonnet-5-5/).first(), "model name")
  expect(/Agent eval, run \d{4}-\d{2}-\d{2}/.test(t), "no run date")
  expect(/claude-sonnet-5-5/.test(t) && /parse_analytics > mode_scores > parsed_documents > control_app/.test(t), "tool-order row missing")
  // The dialog shows what web/lib/eval-summary.json says (itself checked against docs/model-eval.md by vitest).
  const sum = JSON.parse(readFileSync(new URL("../lib/eval-summary.json", import.meta.url), "utf8"))
  for (const m of sum.models) expect(t.includes(`${m.model} ${m.passed} / ${m.total}`), `dialog does not show ${m.model} ${m.passed} / ${m.total}`)
  // Table headers must not run together: a visible gap between neighbouring headers.
  const gaps = await panel.evaluate((root) => [...root.querySelectorAll("thead tr")].flatMap((tr) => {
    // The text's own box, not the cell's: cells always touch, padding is what keeps their words apart.
    const c = [...tr.children].map((e) => { const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect() })
    return c.slice(1).map((r, i) => r.left - c[i].right)
  }))
  expect(gaps.length > 0 && gaps.every((g) => g >= 8), `table headers are too close together (gaps px: ${gaps.map((g) => Math.round(g)).join(",")})`)
  row.notes.push(t.slice(0, 160))
  await shot("eval-visible")
  await panel.getByRole("button", { name: "Close eval results" }).click()
})

await beat("7 data beat", async (row) => {
  await page.getByTestId("spotlight-close").click().catch(() => {})
  const timing = await ask({ chip: DATA })
  const text = await answerText()
  expect(/13\.8/.test(text) && /quarterly_report/.test(text), `answer lacks 13.8 for quarterly_report: ${text.slice(0, 200)}`)
  expect((await lastAnswer().locator("table").count()) > 0, "the answer has no table")
  await page.waitForURL(/documents\/quarterly_report/, { timeout: 20_000 })
  const tab = page.getByTestId("use-data-tab")
  await tab.waitFor({ timeout: 20_000 })
  const card = page.getByTestId("spotlight")
  await card.waitFor({ timeout: 20_000 })
  expect((await card.getAttribute("data-target")) === "use_data_tab", `spotlight is on ${await card.getAttribute("data-target")}, expected use_data_tab`)
  await visible(tab, "Use this data tab")
  await visible(lastAnswer(), "the agent answer")
  await shot("use-data-tab")
  await page.getByTestId("spotlight-close").click().catch(() => {})
  // Read-only snippet runs: the chart values are rows (Q3 = 13.8).
  await page.getByTestId("run-visual_rows").click()
  const rows = page.getByTestId("result-visual_rows")
  await rows.waitFor()
  const rt = (await rows.innerText()).replace(/\s+/g, " ")
  expect(/Q3/.test(rt) && /13\.8/.test(rt), `visuals rows lack Q3 13.8: ${rt.slice(0, 200)}`)
  await visible(rows, "visuals result")
  await page.getByTestId("run-pages").click()
  await page.getByTestId("result-pages").waitFor()
  // The pattern is labelled and has no Run button.
  expect((await page.getByTestId("snippet-dynamic_table").getByTestId("pattern-label").innerText()).includes("pattern, not run here"), "pattern label missing")
  expect((await page.getByTestId("snippet-dynamic_table").getByRole("button", { name: /Run/ }).count()) === 0, "the pattern has a Run button")
  // The billed snippet asks first and shows its size.
  await page.getByTestId("run-ai_extract").click()
  const confirm = page.getByTestId("billed-confirm")
  await confirm.waitFor()
  const ct = (await confirm.innerText()).replace(/\s+/g, " ")
  expect(/tokens/.test(ct) && /AI credits per million tokens/.test(ct), `confirm text: ${ct.slice(0, 200)}`)
  expect((await page.getByTestId("result-ai_extract").count()) === 0, "billed snippet ran before confirmation")
  await visible(confirm, "billed confirm")
  await shot("billed-confirm")
  if (CONFIRM_BILLED) {
    await page.getByTestId("billed-confirm-yes").click()
    await page.getByTestId("result-ai_extract").waitFor({ timeout: 60_000 })
    row.notes.push(`CONFIRMED billed AI_EXTRACT; ${ct.slice(0, 160)}`)
  } else {
    await confirm.getByRole("button", { name: "Cancel" }).click()
    expect((await page.getByTestId("result-ai_extract").count()) === 0, "billed snippet ran after Cancel")
    row.notes.push(`billed snippet cancelled at confirm (nothing billed): ${ct.slice(0, 160)}`)
  }
  // Ask for the SQL: the snippet comes back in the chat with its docs link.
  const t2 = await ask({ typed: "Give me the SQL to pull this document's chart values." })
  const sql = await answerText()
  expect(/VISUAL_DATA_POINTS/.test(sql) && /DOC_ID = 'quarterly_report'/.test(sql), `no matching snippet: ${sql.slice(0, 200)}`)
  expect(/docs\.snowflake\.com/.test(sql), "no docs link")
  row.notes.push(`give me the SQL in ${t2.done.toFixed(1)}s`)
  return timing
})

await beat("8 close and upload control", async (row) => {
  await page.locator('a[href="/"]').first().click()
  await page.waitForURL((u) => u.pathname === "/")
  expect(path() === "/", `expected home, on ${path()}`)
  await visible(page.getByText("Choose a file").first(), "upload control")
  row.notes.push("upload control present (not run)")
})

writeFileSync(`${OUT}/flow.json`, JSON.stringify(results, null, 1))
console.log("\n| beat | pass | first token s | done s |\n|---|---|---|---|")
for (const r of results) console.log(`| ${r.beat} | ${r.pass ? "yes" : "NO"} | ${r.first?.toFixed(1) ?? "-"} | ${r.done.toFixed(1)} |`)
await browser.close()
process.exit(results.every((r) => r.pass) ? 0 : 1)
