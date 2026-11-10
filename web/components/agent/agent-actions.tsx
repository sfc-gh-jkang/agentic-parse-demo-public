"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { AppAction, Target, TourStep, ViewerAction } from "@/lib/app-actions"
import type { ViewerSnapshot } from "@/lib/app-context"

export type Spotlight =
  /** path: the route the highlight belongs to; it clears once the user has been there and leaves. */
  | { kind: "highlight"; target: Target; caption: string; focus?: boolean; path: string; arrived?: boolean }
  | { kind: "tour"; steps: TourStep[]; index: number }

interface Ctx {
  /** Oldest unapplied Demo Agent action; AppController applies it (route, theme, chat, spotlight) and forwards its viewer part. */
  appPending: AppAction | null
  dispatch: (actions: AppAction[]) => void
  consumeApp: () => void
  /** Oldest unapplied viewer change; the viewer applies it (navigating first when it names another Document). */
  pending: ViewerAction | null
  dispatchViewer: (actions: ViewerAction[]) => void
  consume: () => void
  /** What the open viewer shows; null off a Document page. */
  viewer: ViewerSnapshot | null
  setViewer: (s: ViewerSnapshot | null) => void
  /** The chat's "Compare answers across modes" toggle. */
  compareAnswers: boolean
  setCompareAnswers: (on: boolean) => void
  spotlight: Spotlight | null
  setSpotlight: (s: Spotlight | null) => void
}

const AgentActionsContext = createContext<Ctx | null>(null)

/** Lives in the root layout so chat history and queued actions survive a route change. */
export function AgentActionsProvider({ children }: { children: React.ReactNode }) {
  const [appQueue, setAppQueue] = useState<AppAction[]>([])
  const dispatch = useCallback((a: AppAction[]) => setAppQueue((q) => [...q, ...a]), [])
  const consumeApp = useCallback(() => setAppQueue((q) => q.slice(1)), [])
  const [queue, setQueue] = useState<ViewerAction[]>([])
  const dispatchViewer = useCallback((a: ViewerAction[]) => setQueue((q) => [...q, ...a]), [])
  const consume = useCallback(() => setQueue((q) => q.slice(1)), [])
  const [viewer, setViewer] = useState<ViewerSnapshot | null>(null)
  const [compareAnswers, setCompareAnswers] = useState(true)
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null)
  const value = useMemo(
    () => ({
      appPending: appQueue[0] ?? null, dispatch, consumeApp,
      pending: queue[0] ?? null, dispatchViewer, consume,
      viewer, setViewer, compareAnswers, setCompareAnswers, spotlight, setSpotlight,
    }),
    [appQueue, dispatch, consumeApp, queue, dispatchViewer, consume, viewer, compareAnswers, spotlight],
  )
  return <AgentActionsContext.Provider value={value}>{children}</AgentActionsContext.Provider>
}

export function useAgentActions(): Ctx {
  const c = useContext(AgentActionsContext)
  if (!c) throw new Error("useAgentActions needs AgentActionsProvider")
  return c
}

/** For the [App state] line: what the spotlight shows, or null. */
export function describeSpotlight(s: Spotlight | null): string | null {
  if (!s) return null
  if (s.kind === "highlight") return `highlight on ${s.target}`
  return `tour step ${s.index + 1} of ${s.steps.length} on ${s.steps[s.index].target}`
}
