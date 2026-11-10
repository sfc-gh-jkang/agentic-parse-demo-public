// A presenter conversation against the DEPLOYED app: the Demo Agent drives every app control and gives a tour.
// Each turn asserts the resulting app state, then screenshots it. No billed parses (reparse is never asked for).
//
// Run (from web/):
//   SNOWFLAKE_PRIVATE_KEY_PATH=~/.snowflake/keys/<key>.p8 uv run --project .. python ../scripts/app_token.py > /tmp/.app_tok
//   APP_TOKEN_FILE=/tmp/.app_tok node e2e/control.e2e.mjs ; rm /tmp/.app_tok
// Writes OUT_DIR/NN.png and OUT_DIR/transcript.json (default /tmp/agentic-control). Exit 1 if any turn fails.
import { appToken } from "./token.mjs"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { BASE, CONN, ROLE, SCHEMA, WH } from "./config.mjs"

const PW = process.env.PLAYWRIGHT_MODULE ?? "playwright"
const { chromium } = await import(PW)

const TOKEN = appToken()
const OUT = process.env.OUT_DIR ?? "/tmp/agentic-control"
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { Authorization: `Snowflake Token="${TOKEN}"` },
})
const page = await ctx.newPage()
page.setDefaultTimeout(60_000)
const chat = page.getByRole("region", { name: "Demo Agent chat" })

/** Everything a presenter can see, read from the DOM. Pages are 1-based. */
const appState = () =>
  page.evaluate(() => {
    const sel = (label) => document.querySelector(`[role="tablist"][aria-label="${label}"] [aria-selected="true"]`)?.textContent?.trim() ?? null
    const spot = document.querySelector('[data-testid="spotlight"]')
    const pageBtn = [...document.querySelectorAll('[role="group"][aria-label="Page"] button')].find((b) => b.className.includes("bg-primary"))
    return {
      route: location.pathname,
      page: pageBtn ? Number(pageBtn.textContent) : document.querySelector('[data-tour="document_page"]') ? 1 : null,
      view: sel("View"),
      mode: sel("Parse Mode"),
      pair: sel("Compare"),
      visualOpen: !!document.querySelector('[data-tour="visual_detail"]'),
      zoom: document.querySelector('[data-tour="zoom_controls"] span.w-12')?.textContent ?? null,
      missedOpen: document.querySelector('[data-tour="what_was_missed"]')?.open ?? null,
      compareAnswers: document.querySelector('input[aria-label="Compare answers across modes"]')?.checked ?? null,
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      spotlight: spot ? spot.getAttribute("data-target") : null,
      // Ring wraps the first visible target, the caption card is fully on screen, and it is not white in dark mode.
      spotGeom: spot ? (() => {
        const t = [...document.querySelectorAll(`[data-tour="${spot.getAttribute("data-target")}"]`)].find((e) => e.getClientRects().length)
        const ring = document.querySelector('[data-testid="spotlight-ring"]')?.getBoundingClientRect()
        const c = spot.getBoundingClientRect()
        const r = t?.getBoundingClientRect()
        const hdr = document.querySelector("header.sticky")?.getBoundingClientRect().height ?? 0
        const vis = r && { top: Math.max(r.top, hdr), bottom: Math.min(r.bottom, innerHeight), left: Math.max(r.left, 0), right: Math.min(r.right, innerWidth) }
        const visH = vis ? Math.max(0, vis.bottom - vis.top) : 0
        // Ring wraps the visible part of the target; the target is on screen (wholly, or a full 50% of the viewport when tall).
        const wraps = !!(vis && ring && ring.left <= vis.left + 1 && ring.top <= vis.top + 1 && ring.right >= vis.right - 1 && ring.bottom >= vis.bottom - 1)
        const inView = !!r && visH >= Math.min(r.height, 0.5 * innerHeight) - 1
        const notHuge = spot.getAttribute("data-target") === "document_page" || visH < 0.7 * innerHeight
        const covers = !!vis && c.left < vis.right && c.right > vis.left && c.top < vis.bottom && c.bottom > vis.top
        const onScreen = c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight
        const bg = getComputedStyle(spot).backgroundColor
        return { wraps, onScreen, inView, notHuge, covers, bg }
      })() : null,
      tourStep: spot?.getAttribute("data-step") ? Number(spot.getAttribute("data-step")) : null,
    }
  })

const spotOk = (g) => !!g && g.wraps && g.onScreen && g.inView && g.notHuge && !g.covers

async function ask(q, timeout = 240_000) {
  const before = await chat.getByTestId("assistant-message").count()
  await chat.getByLabel("Message the Demo Agent").fill(q)
  await chat.getByRole("button", { name: "Send" }).click()
  const msg = chat.getByTestId("assistant-message").nth(before)
  await msg.waitFor()
  await msg.getByTestId("chat-status").waitFor({ state: "detached", timeout })
  await page.waitForTimeout(2500) // route change, spotlight lookup and smooth scroll settle
  const text = (await msg.innerText()).trim()
  const tools = await msg.locator(".inline-flex, [class*='badge']").allInnerTexts().catch(() => [])
  return { text, tools }
}

const firstSentence = (t) => (t.split("\n").find((l) => l.trim()) ?? "").replace(/^(.{0,180}?[.!?])\s.*$/, "$1").slice(0, 200)
const zoomPct = (z) => Number(String(z ?? "").replace("%", ""))

// [user line, check(state, reply) -> true or a failure string]
const TURNS = [
  ["take me to the homepage", (s, r) => s.route === "/" && !/can.t|cannot/i.test(r) || "not on home"],
  ["open the claim packet", (s) => s.route === "/documents/claim_packet" || "claim_packet not open"],
  ["go to page 3", (s) => s.page === 3 || `page ${s.page}`],
  ["show me what LAYOUT sees", (s) => (s.view === "One mode" && s.mode === "LAYOUT") || `${s.view}/${s.mode}`],
  ["now compare agentic with OCR", (s) => (s.view === "Compare modes" && s.pair === "AGENTIC vs OCR") || `${s.view}/${s.pair}`],
  ["zoom in", (s) => zoomPct(s.zoom) > 100 || `zoom ${s.zoom}`],
  ["open the diagram", (s) => s.visualOpen || "visual detail not open"],
  ["close it", (s) => !s.visualOpen || "visual detail still open"],
  ["what was missed?", (s) => s.missedOpen === true || "What was missed closed"],
  ["explain that relations number", (s, r) => (s.spotlight === "score_strip" && /relation/i.test(r)) || `spotlight ${s.spotlight}`],
  ["give me a tour of this screen", (s) => (s.tourStep === 1 && !!s.spotlight) || `tour step ${s.tourStep}`],
  ["switch to dark mode", (s) => s.theme === "dark" || s.theme],
  ["where am I?", (s, r) => (/claim.?packet/i.test(r) && /page 3/i.test(r)) || "reply does not say claim_packet page 3"],
  ["take me to upload", (s) => (s.route === "/" && s.spotlight === "upload_card") || `${s.route} ${s.spotlight}`],
  ["turn off the compare answers", (s) => s.compareAnswers === false || "compare answers still on"],
  ["go back to the quarterly report page 1", (s) => (s.route === "/documents/quarterly_report" && s.page === 1) || `${s.route} p${s.page}`],
  ["switch back to light mode", (s) => s.theme === "light" || s.theme],
  ["highlight the Cached label and explain what it means", (s, r) => (s.spotlight === "cached_label" && /cached/i.test(r)) || `spotlight ${s.spotlight}`],
  ["clear the highlight", (s) => !s.spotlight || `spotlight ${s.spotlight}`],
  ["fit the whole page", (s) => (s.zoom !== null && zoomPct(s.zoom) <= 100) || `zoom ${s.zoom}`],
  ["scroll down to the parsed text", (s) => s.route.startsWith("/documents/") || s.route],
  ["turn compare answers back on", (s) => s.compareAnswers === true || "compare answers still off"],
]

const transcript = []
let failures = 0
try {
  await page.goto(`${BASE}/documents/quarterly_report`)
  await page.locator('[data-tour="score_strip"]').waitFor()
  await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
  for (const [i, [q, check]] of TURNS.entries()) {
    const n = String(i + 1).padStart(2, "0")
    let reply = { text: "", tools: [] }
    let verdict
    try {
      reply = await ask(q)
      const state = await appState()
      let ok = check(state, reply.text)
      if (ok === true && state.spotGeom && !spotOk(state.spotGeom)) ok = `spotlight geometry ${JSON.stringify(state.spotGeom)}`
      if (ok === true && state.spotGeom && state.theme === "dark" && /255, 255, 255/.test(state.spotGeom.bg)) ok = "spotlight card is white in dark mode"
      verdict = ok === true ? "ok" : `FAIL: ${ok}`
      transcript.push({ n, user: q, reply: firstSentence(reply.text), state, verdict, full: reply.text })
    } catch (e) {
      verdict = `FAIL: ${e.message.split("\n")[0]}`
      transcript.push({ n, user: q, reply: firstSentence(reply.text), state: await appState().catch(() => null), verdict })
    }
    if (verdict !== "ok") failures++
    await page.screenshot({ path: `${OUT}/${n}.png` })
    console.log(`${n} ${verdict.padEnd(4)} | ${q} -> ${transcript.at(-1).reply}`)

    // The tour: walk it with Next and Back, then Esc must close it and leave the app usable.
    if (q.startsWith("give me a tour") && verdict === "ok") {
      const spot = page.getByTestId("spotlight")
      const seen = [await spot.getAttribute("data-target")]
      const geomBad = []
      while (await page.getByTestId("spotlight-next").isVisible().catch(() => false)) {
        await page.getByTestId("spotlight-next").click()
        await page.waitForTimeout(900)
        seen.push(await spot.getAttribute("data-target"))
        const g = (await appState()).spotGeom
        if (!spotOk(g)) geomBad.push(`${seen.at(-1)}:${JSON.stringify(g)}`)
        await page.screenshot({ path: `${OUT}/${n}-tour-${seen.length}.png` })
      }
      await page.getByTestId("spotlight-back").click()
      const back = Number(await spot.getAttribute("data-step"))
      await page.keyboard.press("Escape")
      await page.waitForTimeout(300)
      const closed = !(await spot.isVisible().catch(() => false))
      // The app must still respond to clicks once the tour is closed.
      await page.getByRole("tab", { name: "One mode" }).click()
      await page.getByRole("tab", { name: "One mode", selected: true }).waitFor({ timeout: 5000 })
      const tourOk = seen.length >= 4 && seen.length <= 8 && back === seen.length - 1 && closed && geomBad.length === 0
      if (geomBad.length) console.log("  tour geometry:", geomBad.join(" | "))
      transcript.push({ n: `${n}b`, user: "(clicks Next through the tour, Back once, then Esc)", reply: `${seen.length} steps: ${seen.join(", ")}`, state: await appState(), verdict: tourOk ? "ok" : "FAIL: tour walk" })
      if (!tourOk) failures++
      console.log(`${n}b ${tourOk ? "ok" : "FAIL"} | tour ${seen.join(" > ")} back=${back} closed=${closed}`)
    }
  }
  // "What was missed" expanded, light then dark, for a human to look at.
  await page.getByRole("button", { name: "Close" }).first().click().catch(() => {})
  const details = page.locator('[data-tour="what_was_missed"]')
  if (!(await details.evaluate((d) => d.open))) await details.locator("summary").click()
  await details.scrollIntoViewIfNeeded()
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => { document.documentElement.classList.toggle("dark", t === "dark"); localStorage.setItem("theme", t) }, theme)
    await page.waitForTimeout(400)
    await details.screenshot({ path: `${OUT}/missed-${theme}.png` })
    const h = await details.evaluate((d) => Math.max(...[...d.querySelectorAll('[data-testid^="missed-"]')].map((e) => e.getBoundingClientRect().height)))
    console.log(`missed-${theme} column max height ${Math.round(h)}px`)
    if (h > 250) { failures++; console.log("FAIL: missed panel column taller than 250px") }
  }
} finally {
  writeFileSync(`${OUT}/transcript.json`, JSON.stringify(transcript, null, 2))
  await browser.close()
}
console.log(failures ? `FAIL: ${failures} turn(s)` : "PASS")
process.exit(failures ? 1 : 0)
