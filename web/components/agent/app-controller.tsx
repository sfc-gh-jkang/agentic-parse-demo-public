"use client"

import { useCallback, useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "@/components/theme-provider"
import { useAgentActions } from "@/components/agent/agent-actions"
import { Spotlight } from "@/components/agent/spotlight"
import { viewerPart, type ScrollTo, type TourStep, type ViewerAction } from "@/lib/app-actions"
import { findTarget } from "@/lib/spotlight"
import { CHAT_OPEN_EVENT, TOUR_STEPS } from "@/lib/onboarding"
import { assumptionsStore, volumeStore } from "@/lib/value"

const VALUE_CAPTION = "What AGENTIC is worth, from stored data: measured credits against facts recovered, pages left to check by hand, and cost per correct fact."
const VOLUME_CAPTION = "Pages per month and your review assumptions, set for you. Credits, pages to check and review hours per Parse Mode update below: an estimate from measured rates on this corpus."
const USE_DATA_CAPTION = "Use this data: runnable SQL for this Document's pages, its chart values as rows, a Cortex Search query and an AI_EXTRACT example."
const UPLOAD_CAPTION = "Drop a PDF, image or Office file here, or Choose a file. It is parsed live in AGENTIC mode and becomes searchable by the Demo Agent."

/** Tour step: waits for the first Visual box on the page, then clicks it (read-only; opens its detail). */
function openFirstVisual() {
  let tries = 0
  const go = () => {
    if (findTarget("visual_detail")) return
    const box = findTarget("visual_box")
    if (box) box.click()
    else if (tries++ < 30) setTimeout(go, 200)
  }
  setTimeout(go, 300)
}

/** Waits for the route to render, then scrolls. */
function scrollLater(to: ScrollTo) {
  let tries = 0
  const go = () => {
    if (to === "top") return window.scrollTo({ top: 0, behavior: "smooth" })
    if (to === "bottom") return window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })
    const el = findTarget(to === "document" ? "document_page" : "parsed_text")
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" })
    else if (tries++ < 20) setTimeout(go, 150)
  }
  setTimeout(go, 150)
}

/**
 * Applies Demo Agent app actions: route, theme, chat toggle, scroll and spotlight here; the viewer part is
 * forwarded to the Document viewer (opening the named Document first when another page is showing).
 */
export function AppController() {
  const { appPending, consumeApp, pending, consume, dispatchViewer, setCompareAnswers, spotlight, setSpotlight } = useAgentActions()
  const router = useRouter()
  const path = usePathname() ?? "/"
  const onDoc = path.startsWith("/documents/")
  const { setTheme } = useTheme()

  // Off a Document page no viewer consumes actions: open the named Document (its viewer then applies the action),
  // and drop a change that names no Document, since there is nothing to apply it to.
  useEffect(() => {
    if (!pending || onDoc) return
    if (pending.doc) router.push(`/documents/${pending.doc}`)
    else consume()
  }, [pending, onDoc, router, consume])

  // A highlight belongs to one route: it waits while the app navigates there, then clears when the user leaves.
  useEffect(() => {
    if (spotlight?.kind !== "highlight") return
    if (path === spotlight.path) {
      if (!spotlight.arrived) setSpotlight({ ...spotlight, arrived: true })
    } else if (spotlight.arrived) setSpotlight(null)
  }, [path, spotlight, setSpotlight])

  const toViewer = useCallback((v: ViewerAction | null) => {
    if (v && (v.doc || onDoc)) dispatchViewer([v])
  }, [onDoc, dispatchViewer])

  useEffect(() => {
    const a = appPending
    if (!a) return
    consumeApp()
    const valueView = a.action === "open_value_panel" || a.action === "set_volume" || a.action === "set_review_assumptions"
    if ((a.action === "go_home" || a.action === "open_upload" || valueView) && path !== "/") router.push("/")
    if ((a.action === "set_volume" || a.action === "set_review_assumptions") && a.volume !== undefined) volumeStore.set(a.volume)
    if (a.action === "set_volume" || a.action === "set_review_assumptions") {
      assumptionsStore.set({
        ...(a.reviewMinutes !== undefined ? { minutesPerPage: a.reviewMinutes } : {}),
        ...(a.hourlyRate !== undefined ? { hourlyRate: a.hourlyRate } : {}),
        ...(a.creditPrice !== undefined ? { pricePerCredit: a.creditPrice } : {}),
      })
    }
    if (a.theme) setTheme(a.theme)
    if (a.compareAnswers !== undefined) setCompareAnswers(a.compareAnswers)
    toViewer(viewerPart(a))
    const home = a.action === "go_home" || a.action === "open_upload" || valueView
    const dest = home ? "/" : a.doc ? `/documents/${a.doc}` : path
    if (a.action === "open_upload") setSpotlight({ kind: "highlight", target: "upload_card", caption: a.caption ?? UPLOAD_CAPTION, focus: true, path: "/" })
    else if (a.action === "open_value_panel") setSpotlight({ kind: "highlight", target: "value_panel", caption: a.caption ?? VALUE_CAPTION, path: "/" })
    else if (a.action === "set_volume" || a.action === "set_review_assumptions") setSpotlight({ kind: "highlight", target: "volume_input", caption: a.caption ?? VOLUME_CAPTION, path: "/" })
    else if (a.action === "open_use_data_tab") setSpotlight({ kind: "highlight", target: "use_data_tab", caption: a.caption ?? USE_DATA_CAPTION, path: dest })
    else if (a.action === "start_tour") setSpotlight({ kind: "tour", steps: TOUR_STEPS, index: 0 })
    else if (a.action === "tour" && a.steps) setSpotlight({ kind: "tour", steps: a.steps, index: 0 })
    else if (a.target && a.caption) setSpotlight({ kind: "highlight", target: a.target, caption: a.caption, path: dest })
    else if (a.action === "clear_highlight" || (home && !valueView) || (a.doc && spotlight?.kind === "highlight")) setSpotlight(null)
    if (a.scroll) scrollLater(a.scroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appPending])

  const onStep = useCallback((s: TourStep) => {
    if (s.route === "home") {
      if (path !== "/") router.push("/")
    } else if (s.doc || s.page !== undefined || s.view || s.mode) {
      toViewer({
        ...(s.doc ? { doc: s.doc } : {}), ...(s.page !== undefined ? { page: s.page - 1 } : {}),
        ...(s.view ? { view: s.view } : {}), ...(s.mode ? { mode: s.mode } : {}),
        ...(s.ui === "open_data_tab" ? { tab: "data" as const } : {}),
      })
    }
    if (s.ui === "chat_open") window.dispatchEvent(new Event(CHAT_OPEN_EVENT))
    if (s.ui === "open_first_visual") openFirstVisual()
  }, [path, router, toViewer])

  return <Spotlight onStep={onStep} />
}
