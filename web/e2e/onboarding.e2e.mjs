// Onboarding: first-visit welcome, the guided tour (every step asserted by what is VISIBLE in the viewport),
// New chat, and Reset demo clearing the chat. Needs no agent unless WITH_AGENT=1 (then also asks for a tour).
//   (cd web && SNOWFLAKE_CONNECTION_NAME=<your-connection> npm run dev)   # any agent; the tour itself never calls it
//   (cd web && OUT_DIR=/tmp/t21-tour node e2e/onboarding.e2e.mjs)
// WITH_AGENT=1 AGENT_NAME=<temp agent>: also asks the Demo Agent "Give me a tour of the demo" and expects the same tour.
// Reset demo calls POST /api/reset (deletes uploads only; the corpus is untouched).
// Env: APP_URL, OUT_DIR (default /tmp/t21-tour), APP_TOKEN_FILE. Exit 1 on any failed check.
import { optionalAuthHeaders } from "./token.mjs"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const PW = process.env.PLAYWRIGHT_MODULE ?? "playwright"
const { chromium } = await import(PW)
const BASE = process.env.APP_URL ?? "http://localhost:3000"
const OUT = process.env.OUT_DIR ?? "/tmp/t21-tour"
mkdirSync(OUT, { recursive: true })
const headers = optionalAuthHeaders()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: headers })
const page = await ctx.newPage()
page.setDefaultTimeout(30_000)
const chat = page.getByRole("region", { name: "Demo Agent chat" })
const results = []
let n = 0
const shot = async (name) => {
  n += 1
  const p = `${OUT}/${String(n).padStart(2, "0")}-${name}.png`
  await page.screenshot({ path: p })
  return p
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
const path = () => new URL(page.url()).pathname

/** The element is on screen for a viewer: mostly inside the viewport and not covered by another element. */
async function visible(loc, what, opts = {}) {
  // The page may still be settling (route change, scroll, animation): retry for ~3 s before failing.
  let last
  for (let i = 0; i < 15; i++) {
    try {
      return await visibleOnce(loc, what, opts)
    } catch (e) {
      last = e
      await page.waitForTimeout(200)
    }
  }
  throw last
}
async function visibleOnce(loc, what, { overlay = false } = {}) {
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
  expect(overlay || !r.covered, `${what} is covered by ${r.by}`)
}


const STEPS = [
  { target: "cost_stats", path: "/" },
  { target: "document_list", path: "/" },
  { target: "score_strip", path: "/documents/quarterly_report" },
  { target: "visual_box", path: "/documents/quarterly_report" },
  { target: "visual_detail", path: "/documents/quarterly_report" },
  { target: "compare_pair_tabs", path: "/documents/quarterly_report" },
  { target: "chat_panel", path: "/documents/quarterly_report" },
  { target: "presenter_questions", path: "/documents/quarterly_report" },
  { target: "eval_button", path: "/documents/quarterly_report" },
  { target: "value_panel", path: "/" },
  { target: "use_data_tab", path: "/documents/quarterly_report" },
  { target: "upload_card", path: "/" },
]

async function check(name, fn) {
  const row = { check: name, pass: false, notes: [] }
  try {
    await fn(row)
    row.pass = true
  } catch (e) {
    row.notes.push(`FAIL: ${String(e.message).split("\n")[0]}`)
    row.shot = await shot(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-FAILED`)
  }
  results.push(row)
  console.log(`${row.pass ? "PASS" : "FAIL"} ${name} ${row.notes.join("; ")}`)
}

/** One tour step: the card, its ring and the target are all on screen, on the right page, with the right counter. */
async function assertStep(i) {
  const s = STEPS[i]
  const card = page.getByTestId("spotlight")
  await page.waitForFunction(([t, k]) => document.querySelector('[data-testid="spotlight"]')?.getAttribute("data-target") === t && document.querySelector('[data-testid="spotlight"]')?.getAttribute("data-step") === String(k), [s.target, i + 1], { timeout: 20_000 })
  await visible(card, `step ${i + 1} card`)
  await visible(page.getByTestId("spotlight-caption"), `step ${i + 1} caption`)
  expect(/Tour · \d+ of 12/.test(await card.innerText()) && (await card.innerText()).includes(`Tour · ${i + 1} of 12`), `step counter is not ${i + 1} of 12`)
  await page.waitForFunction(() => document.querySelector('[data-testid="spotlight-ring"]'), null, { timeout: 8_000 })
  await visible(page.getByTestId("spotlight-ring"), `step ${i + 1} ring`, { overlay: true })
  await visible(page.locator(`[data-tour="${s.target}"]`), `step ${i + 1} target ${s.target}`)
  // The ring is ON the target (>= 80% of the target's visible box inside the ring) and the caption is NOT on it.
  // Polled: the target may still be mounting or moving (route change, chat opening) for a moment.
  let geo
  for (let k = 0; k < 20; k++) {
    geo = await page.evaluate((t) => {
      const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })
      const inter = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))
      const area = (a) => Math.max(0, a.r - a.l) * Math.max(0, a.b - a.t)
      const card = box(document.querySelector('[data-testid="spotlight"]').getBoundingClientRect())
      const ring = box(document.querySelector('[data-testid="spotlight-ring"]').getBoundingClientRect())
      const el = [...document.querySelectorAll(`[data-tour="${t}"]`)].find((e) => e.getClientRects().length)
      const hdr = document.querySelector("header.sticky")?.getBoundingClientRect().height ?? 0
      const r = el.getBoundingClientRect()
      const vis = { l: Math.max(r.left, 0), t: Math.max(r.top, hdr), r: Math.min(r.right, innerWidth), b: Math.min(r.bottom, innerHeight) }
      return { ringOnTarget: inter(ring, vis) / Math.max(1, area(vis)), cardOnTarget: inter(card, vis) / Math.max(1, area(vis)) }
    }, s.target)
    if (geo.ringOnTarget >= 0.8 && geo.cardOnTarget < 0.05) break
    await page.waitForTimeout(200)
  }
  expect(geo.ringOnTarget >= 0.8, `step ${i + 1} ring covers only ${(geo.ringOnTarget * 100).toFixed(0)}% of ${s.target}`)
  expect(geo.cardOnTarget < 0.05, `step ${i + 1} caption covers ${(geo.cardOnTarget * 100).toFixed(0)}% of ${s.target}`)
  expect(path() === s.path, `step ${i + 1} should be on ${s.path}, is on ${path()}`)
  expect(!(await page.getByTestId("spotlight-caption").innerText()).includes("not on this screen"), `step ${i + 1} target missing`)
  return shot(`step-${String(i + 1).padStart(2, "0")}-${s.target}`)
}

await check("1 first visit shows the welcome once", async (row) => {
  await page.goto(BASE + "/")
  const w = page.getByTestId("welcome")
  await w.waitFor()
  await visible(w, "welcome dialog")
  await visible(page.getByTestId("welcome-tour"), "Take the tour button")
  await visible(page.getByTestId("welcome-skip"), "Skip button")
  expect(/AGENTIC.*LAYOUT.*OCR/s.test(await w.innerText()), "welcome does not name the three Parse Modes")
  row.notes.push((await w.innerText()).replace(/\s+/g, " ").slice(0, 120))
  await shot("welcome")
  await page.getByTestId("welcome-skip").click()
  await w.waitFor({ state: "detached" })
  await page.reload()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(800)
  expect((await page.getByTestId("welcome").count()) === 0, "welcome came back after Skip and a reload")
})

await check("2 Take the tour is in the header and Commands", async () => {
  await visible(page.getByTestId("take-tour"), "header Take the tour")
  await page.getByRole("button", { name: "Open command palette" }).click()
  await visible(page.getByRole("option", { name: "Take the tour" }), "Commands: Take the tour")
  await shot("commands-take-the-tour")
  await page.keyboard.press("Escape")
})

await check("3 guided tour, all 12 steps", async (row) => {
  await page.goto(BASE + "/")
  await page.getByTestId("take-tour").click()
  const shots = []
  for (let i = 0; i < STEPS.length; i++) {
    shots.push(await assertStep(i))
    if (i === 3) {
      // Back goes to the previous step (same page) and Next returns.
      await page.getByTestId("spotlight-back").click()
      await assertStep(2)
      await page.getByTestId("spotlight-next").click()
      await assertStep(3)
    }
    if (i < STEPS.length - 1) await page.getByTestId("spotlight-next").click()
  }
  await visible(page.getByTestId("spotlight-done"), "Done button")
  await page.getByTestId("spotlight-done").click()
  await page.getByTestId("spotlight").waitFor({ state: "detached" })
  row.notes.push(`${shots.length} steps, screenshots ${OUT}`)
})

await check("4 Exit and Esc end the tour; nothing was billed", async () => {
  await page.goto(BASE + "/")
  await page.getByTestId("take-tour").click()
  await assertStep(0)
  await page.getByTestId("spotlight-close").click()
  await page.getByTestId("spotlight").waitFor({ state: "detached" })
  await page.getByTestId("take-tour").click()
  await assertStep(0)
  await page.keyboard.press("Escape")
  await page.getByTestId("spotlight").waitFor({ state: "detached" })
  expect((await page.getByRole("alert").filter({ hasText: "billed" }).count()) === 0, "a billed-parse banner appeared during the tour")
})

await check("5 chat history is kept across a reload, New chat clears it", async (row) => {
  await page.goto(BASE + "/")
  await page.evaluate(() => sessionStorage.setItem("agentic-parse-demo:chat", JSON.stringify([
    { role: "user", text: "What was Q3 revenue?" }, { role: "assistant", text: "Q3 revenue was 13.8 (quarterly_report, page 1).", turn: { done: true, steps: [], tools: [], actions: [], text: "x" } },
  ])))
  await page.reload()
  await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
  await visible(chat.getByText("What was Q3 revenue?"), "restored question")
  await visible(chat.getByText(/Q3 revenue was 13\.8/), "restored answer")
  const nc = chat.getByTestId("new-chat")
  await visible(nc, "New chat button")
  expect(await nc.isEnabled(), "New chat should be enabled with history")
  await shot("chat-with-history")
  await nc.click()
  await chat.getByTestId("presenter-questions").waitFor()
  await visible(chat.getByTestId("presenter-questions").getByRole("button").first(), "presenter chips after New chat")
  expect((await chat.getByText("What was Q3 revenue?").count()) === 0, "old question still shown after New chat")
  expect(await nc.isDisabled(), "New chat should be disabled on an empty chat")
  const saved = await page.evaluate(() => sessionStorage.getItem("agentic-parse-demo:chat"))
  expect(saved === "[]", `saved history after New chat is ${saved}`)
  await page.reload()
  await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
  await chat.getByTestId("presenter-questions").waitFor()
  expect((await chat.getByText("What was Q3 revenue?").count()) === 0, "history came back after reload")
  await shot("new-chat-empty")
  row.notes.push("sessionStorage key agentic-parse-demo:chat")
})

await check("6 Reset demo clears chat history and /api/reset is JSON only", async (row) => {
  await page.goto(BASE + "/")
  await page.evaluate(() => sessionStorage.setItem("agentic-parse-demo:chat", JSON.stringify([{ role: "user", text: "old question" }, { role: "assistant", text: "old answer", turn: { done: true, steps: [], tools: [], actions: [], text: "x" } }])))
  await page.reload()
  await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
  await visible(chat.getByText("old question"), "history before reset")
  await page.getByTestId("reset-demo").click()
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/reset") && r.request().method() === "POST")
  await page.getByTestId("reset-demo-confirm").click()
  const r = await resp
  expect(r.status() === 200 && (r.headers()["content-type"] ?? "").includes("application/json"), `reset response ${r.status()} ${r.headers()["content-type"]}`)
  const again = await fetch(BASE + "/api/reset", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" })
  const body = await again.json()
  expect(body.ok === true && !("chat" in body), "reset body should be plain JSON {ok, uploadsRemoved}")
  const form = await fetch(BASE + "/api/reset", { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: "{}" })
  expect(form.status === 415, `non-JSON POST to /api/reset should be 415, got ${form.status}`)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1000)
  await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
  await chat.getByTestId("presenter-questions").waitFor()
  expect((await chat.getByText("old question").count()) === 0, "history survived Reset demo")
  expect((await page.evaluate(() => sessionStorage.getItem("agentic-parse-demo:chat"))) === null || (await page.evaluate(() => sessionStorage.getItem("agentic-parse-demo:chat"))) === "[]", "chat key still holds history")
  expect((await page.getByTestId("welcome").count()) === 0, "Reset demo must not bring the welcome back")
  await shot("after-reset")
  row.notes.push(`uploadsRemoved=${body.uploadsRemoved}`)
})

if (process.env.WITH_AGENT === "1") {
  await check("7 asking the agent for a tour starts the same tour", async (row) => {
    await page.goto(BASE + "/")
    await page.getByRole("button", { name: "Open Demo Agent chat" }).click()
    await chat.getByRole("textbox", { name: "Message the Demo Agent" }).fill("Give me a tour of the demo")
    await chat.getByRole("button", { name: "Send" }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="spotlight"]')?.getAttribute("data-step") === "1", null, { timeout: 90_000 })
    await assertStep(0)
    await page.getByTestId("spotlight-next").click()
    await assertStep(1)
    row.notes.push("agent started the built-in tour (start_tour)")
  })
}

writeFileSync(`${OUT}/onboarding.json`, JSON.stringify(results, null, 1))
console.log("\n| check | pass |\n|---|---|")
for (const r of results) console.log(`| ${r.check} | ${r.pass ? "yes" : "NO"} |`)
await browser.close()
process.exit(results.every((r) => r.pass) ? 0 : 1)
