"use client"

import { useEffect, useRef, useState } from "react"
import { ChatMarkdown } from "@/components/agent/chat-markdown"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { usePathname } from "next/navigation"
import { AlertTriangle, Loader2, MessageSquare, Plus, Send, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { describeSpotlight, useAgentActions } from "@/components/agent/agent-actions"
import { useTheme } from "@/components/theme-provider"
import { addLiveRunId } from "@/lib/upload-utils"
import { statusLabel, citationAction, citationLabel, emptyTurn, extractCitations, parseSseChunk, reduceAgentEvent, type AgentTurn, type Citation } from "@/lib/agent-stream"
import { fetchJson, type DocumentSummary } from "@/lib/doc-utils"
import { withAppContext, type AppSnapshot } from "@/lib/app-context"
import { agentHistory, clearChatStorage, COMPARE_KEY, loadChat, MAX_MESSAGE_CHARS, recentForAgent, saveChat, type ChatMessage } from "@/lib/chat-history"
import { CHAT_OPEN_EVENT } from "@/lib/onboarding"
import { ASK_SAMPLES, citedDocs, showCompareResult, compareAfterAgent, isViewerCommand, loadComparePref, pickAskDocNow, saveComparePref, type AskResult } from "@/lib/ask"
import { EvalResults } from "@/components/agent/eval-results"
import evalSummary from "@/lib/eval-summary.json"
import { HowIAnswered } from "@/components/agent/how-i-answered"
import { CompareTable, type CompareState } from "@/components/agent/compare-table"


const SAMPLES = [
  "Show me page 2 of claim_packet in compare view against OCR",
  "give me a tour of this page",
  "What are the measured AI credits per 1000 pages for OCR, LAYOUT and AGENTIC?",
]
/** Presenter chips, in storyline order (docs/talk-track.md). Each question is asked verbatim in eval/questions.yaml. */
export const PAYOFF_QUESTION = "In quarterly_report, what was Q3 revenue on the revenue chart?"
/** Value beat, right after the opening payoff: value_story, then control_app open_value_panel (eval id value_worth_it). */
export const VALUE_QUESTION = "Why does AGENTIC matter, and is it worth the cost?"
/** Value beat, second chip: the reader's own review assumptions (eval id value_review_5min_60h). */
export const REVIEW_QUESTION = "If review takes 5 minutes a page at $60/hour, what does 50,000 pages a month cost?"
/** Needs four dependent tools in order: parse_analytics, mode_scores, parsed_documents, control_app (eval id multi_step_headline). */
export const HEADLINE_QUESTION =
  "Which Document does AGENTIC beat LAYOUT on by the most Facts inside images? Show me its scores first, then find the page where those Facts are, and highlight the result on screen."
export const TRAP_QUESTION = "What was the stamped invoice's total in Japanese yen, and how many credits did the 2025 parse runs use?"
export const REPARSE_QUESTION = "Re-parse receipt_photo in AGENTIC mode."
/** Data-product beat, before the close: parse_analytics over VISUAL_DATA_POINTS, then control_app open_use_data_tab (eval id data_q3_across_reports). */
export const DATA_QUESTION = "Compare Q3 revenue across the reports."
export const EVAL_CHIP = "Show eval results"
export const PRESENTER_QUESTIONS = [PAYOFF_QUESTION, VALUE_QUESTION, REVIEW_QUESTION, HEADLINE_QUESTION, TRAP_QUESTION, REPARSE_QUESTION, DATA_QUESTION]

/** Seconds since mount, ticking while the answer streams. */
function Elapsed() {
  const [start] = useState(() => Date.now())
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="tabular-nums" data-testid="chat-elapsed">{Math.floor((Date.now() - start) / 1000)} s</span>
}

async function askModes(doc: string, question: string): Promise<AskResult> {
  const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc, question }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j
}

function CitationChips({ text, known, onPick, shownPath }: { text: string; known?: Set<string>; onPick: (c: Citation) => void; shownPath: string | null }) {
  const cites = extractCitations(text, known)
  if (!cites.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {cites.map((c, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(c)}
          className="rounded-full border bg-background px-2 py-0.5 text-xs hover:bg-accent"
          title={c.kind === "doc" ? "Jump the viewer here" : `Design doc: ${c.path}`}
        >
          {citationLabel(c)}
        </button>
      ))}
    </div>
  )
}

export function ChatPanel() {
  const { dispatch, dispatchViewer, viewer, compareAnswers: compare, setCompareAnswers: setCompare, spotlight } = useAgentActions()
  const path = usePathname() ?? "/"
  const { resolvedTheme } = useTheme()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [showEval, setShowEval] = useState(false)
  const [shownPath, setShownPath] = useState<string | null>(null)
  const [cmp, setCmp] = useState<Record<string, CompareState>>({})
  const scroller = useRef<HTMLDivElement>(null)
  const inputEl = useRef<HTMLInputElement>(null)
  // Keyboard users land in the input when they open the chat; a restored-open panel does not steal focus on load.
  const focusOnOpen = useRef(false)
  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false
      inputEl.current?.focus()
    }
  }, [open])
  // The guided tour opens the chat (lib/onboarding.ts) without owning its state.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(CHAT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(CHAT_OPEN_EVENT, onOpen)
  }, [])
  const docs = useQuery({ queryKey: ["documents"], queryFn: () => fetchJson<{ documents: DocumentSummary[] }>("/api/documents") })
  const known = docs.data ? new Set(docs.data.documents.map((d) => d.docId)) : undefined

  // Restore after mount (sessionStorage is client-only), then save every change.
  const restored = useRef(false)
  useEffect(() => {
    const saved = loadChat()
    if (saved.length) setMessages(saved)
    setCompare(loadComparePref())
    try {
      const c = JSON.parse(sessionStorage.getItem(COMPARE_KEY) ?? "{}")
      if (c && typeof c === "object") setCmp(c)
    } catch { /* ignore */ }
    restored.current = true
  }, [])
  useEffect(() => {
    if (restored.current) saveChat(messages)
  }, [messages])
  // The Demo Agent can flip the toggle too, so save it wherever it changed.
  useEffect(() => {
    if (restored.current) saveComparePref(compare)
  }, [compare])
  useEffect(() => {
    if (!restored.current) return
    const done = Object.fromEntries(Object.entries(cmp).filter(([, v]) => v.status === "done" || v.status === "nodoc"))
    sessionStorage.setItem(COMPARE_KEY, JSON.stringify(done))
  }, [cmp])

  // Latest comparison request per message: a late reply to a superseded or hidden request is dropped.
  const cmpReq = useRef<Record<string, string | null>>({})
  const runCompare = (id: string, doc: string, q: string) => {
    cmpReq.current[id] = doc
    setCmp((c) => ({ ...c, [id]: { status: "loading", doc } }))
    const settle = (s: CompareState) => {
      if (cmpReq.current[id] === doc) setCmp((c) => ({ ...c, [id]: s }))
    }
    askModes(doc, q)
      .then((result) => settle({ status: "done", result }))
      .catch((e) => settle({ status: "error", doc, message: e instanceof Error ? e.message : String(e) }))
  }
  const hideCompare = (id: string) => {
    cmpReq.current[id] = null
    setCmp((c) => {
      const { [id]: _drop, ...rest } = c
      return rest
    })
  }

  useEffect(() => {
    scroller.current?.scrollTo({ top: messages.length ? scroller.current.scrollHeight : 0 })
  }, [messages, open, cmp])

  const pick = (c: Citation) => {
    const a = citationAction(c)
    if (a) dispatchViewer([a])
    else if (c.kind === "design") setShownPath((p) => (p === c.path ? null : c.path))
  }

  const snapshot = (): AppSnapshot => ({
    route: path === "/" ? "home" : path.startsWith("/documents/") ? "document" : "other",
    viewer,
    homeDocs: path === "/" ? (docs.data?.documents ?? []).map((d) => d.docId) : [],
    compareAnswers: compare,
    theme: resolvedTheme === "dark" ? "dark" : "light",
    spotlight: describeSpotlight(spotlight),
  })

  // A confirmed agent re-parse: label the new run Live, refetch what the viewer shows and switch to that Mode.
  const showReparsed = (r: NonNullable<AgentTurn["reparsed"]>) => {
    addLiveRunId(r.runId)
    for (const k of ["runs", "visuals", "comparison"]) qc.invalidateQueries({ queryKey: [k, r.doc] })
    qc.invalidateQueries({ queryKey: ["documents"] })
    dispatchViewer([{ doc: r.doc, mode: r.mode as "AGENTIC" | "LAYOUT" | "OCR", view: "one" }])
  }

  /** Starts an empty chat. Not while an answer is streaming: its messages would be written into the new chat. */
  function newChat() {
    if (busy) return
    clearChatStorage(sessionStorage)
    cmpReq.current = {}
    setMessages([])
    setCmp({})
    setShownPath(null)
    setInput("")
  }

  async function send(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setInput("")
    setBusy(true)
    const history = [...messages, { role: "user" as const, text: q }]
    const askId = compare && !isViewerCommand(q) ? `${Date.now()}-${history.length}` : undefined
    // The comparison runs alongside the agent call; it never delays the agent's answer.
    const started = askId ? pickAskDocNow(q, viewer?.doc, known) : null
    if (askId && started) runCompare(askId, started.doc, q)
    setMessages([...history, { role: "assistant", text: "", turn: emptyTurn(), askId }])
    const setTurn = (turn: AgentTurn) => setMessages((m) => [...m.slice(0, -1), { role: "assistant", text: turn.text, turn, askId }])
    let turn = emptyTurn()
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: recentForAgent(agentHistory(history)).map((m, i, all) => ({
              role: m.role,
              content: [{ type: "text", text: i === all.length - 1 ? withAppContext(m.text, snapshot()) : m.text }],
            })),
        }),
      })
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ""
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const { events, rest } = parseSseChunk(buf)
        buf = rest
        for (const ev of events) {
          const before = turn.actions.length
          const hadReparsed = turn.reparsed
          turn = reduceAgentEvent(turn, ev)
          if (turn.actions.length > before) dispatch(turn.actions.slice(before))
          if (turn.reparsed && !hadReparsed) showReparsed(turn.reparsed)
        }
        setTurn(turn)
      }
      const tail = parseSseChunk(buf + "\n\n").events
      for (const ev of tail) {
        const before = turn.actions.length
        const hadReparsed = turn.reparsed
        turn = reduceAgentEvent(turn, ev)
        if (turn.actions.length > before) dispatch(turn.actions.slice(before))
        if (turn.reparsed && !hadReparsed) showReparsed(turn.reparsed)
      }
      setTurn({ ...turn, done: true })
      if (askId && !turn.error) {
        const next = compareAfterAgent(started, turn.tools, citedDocs(turn.text, known, turn.actions))
        if (next.kind === "hide") hideCompare(askId)
        else if (next.kind === "run") runCompare(askId, next.doc, q)
        else if (next.kind === "nodoc") setCmp((c) => ({ ...c, [askId]: { status: "nodoc" } }))
      }
    } catch (e) {
      setTurn({ ...turn, error: e instanceof Error ? e.message : "Request failed", done: true })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button onClick={() => { focusOnOpen.current = true; setOpen(true) }} data-tour="chat_panel" className="fixed bottom-4 right-4 z-50 shadow-lg" aria-label="Open Demo Agent chat">
        <MessageSquare className="mr-2 h-4 w-4" /> Ask the Demo Agent
      </Button>
    )
  }

  const presenterChips = (tag: boolean) => (
    <div className="flex flex-wrap gap-1.5" data-testid="presenter-questions" {...(tag ? { "data-tour": "presenter_questions" } : {})}>
      {PRESENTER_QUESTIONS.map((s) => (
        <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-primary px-2.5 py-1 text-left text-xs text-foreground hover:bg-accent">
          {s}
        </button>
      ))}
      <button type="button" onClick={() => setShowEval(true)} className="rounded-full border border-primary px-2.5 py-1 text-left text-xs text-foreground hover:bg-accent">
        {EVAL_CHIP}
      </button>
    </div>
  )

  return (
    <section aria-label="Demo Agent chat" data-tour="chat_panel" className="fixed bottom-4 right-4 z-50 flex max-h-[65vh] w-[min(420px,calc(100vw-2rem))] flex-col rounded-lg border bg-background shadow-xl">
      {showEval && (
        <div role="dialog" aria-label="Agent eval results" data-testid="eval-panel" className="fixed inset-x-4 top-16 z-[60] mx-auto max-h-[75vh] max-w-3xl overflow-auto rounded-lg border bg-background p-4 shadow-2xl">
          <EvalResults summary={evalSummary} />
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowEval(false)}>Close eval results</Button>
        </div>
      )}
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <MessageSquare className="h-4 w-4" />
        <span className="text-sm font-semibold">Demo Agent</span>
        <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowEval((v) => !v)} aria-pressed={showEval} data-tour="eval_button">Eval results</Button>
        <Button size="sm" variant="ghost" className="ml-auto text-xs" onClick={newChat} disabled={busy || messages.length === 0} data-testid="new-chat" title="Clear this conversation and start a new one">
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />New chat
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="Collapse chat">
          <X className="h-4 w-4" />
        </Button>
      </header>
      <label data-tour="compare_answers_toggle" className="flex items-center gap-2 border-b px-3 py-1.5 text-xs" title="Also answer from each Parse Mode's text alone, side by side">
        <input
          type="checkbox"
          checked={compare}
          aria-label="Compare answers across modes"
          onChange={(e) => {
            setCompare(e.target.checked)
            saveComparePref(e.target.checked)
          }}
        />
        Compare answers across modes
        <span className="ml-auto truncate text-muted-foreground">{viewer?.doc ? `on ${viewer.doc}` : "on the Document you name"}</span>
      </label>
      <div ref={scroller} data-testid="chat-messages" className="min-h-[120px] flex-1 space-y-3 overflow-auto p-3 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2 text-muted-foreground">
            <p>Ask about a Document, or tell me what to show. With Compare on, each answer also shows what the AGENTIC, LAYOUT and OCR parses alone can answer.</p>
            <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-foreground">Presenter questions</p>
            {presenterChips(true)}
            <p className="pt-1 text-xs">More examples</p>
            {[...ASK_SAMPLES.map((x) => x.q), ...SAMPLES].filter((s) => !PRESENTER_QUESTIONS.includes(s)).map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded border px-2 py-1 text-left text-xs hover:bg-accent">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} dir="auto" className="ml-8 rounded-lg bg-primary px-3 py-2 text-primary-foreground">{m.text}</div>
          ) : (
            <div key={i} className="mr-4 space-y-2" data-testid="assistant-message">
              {m.turn?.reparse && (
                <div role="alert" className="flex items-start gap-2 rounded border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span><strong>Live, billed parse.</strong> The agent is re-parsing a Document with AI_PARSE_DOCUMENT; this uses AI credits.</span>
                </div>
              )}
              {m.text && (
                <ChatMarkdown text={m.text} />
              )}
              {m.turn && !(m.turn.done || m.turn.answered) && (
                <div role="status" className="flex items-center gap-2 rounded-md border border-primary/40 bg-accent px-2 py-1.5 text-sm font-medium text-foreground" data-testid="chat-status">
                  <Loader2 className="h-4 w-4 animate-spin" /> <span>{statusLabel(m.turn)}</span>
                  <span className="ml-auto text-xs font-normal text-muted-foreground"><Elapsed /></span>
                </div>
              )}
              {m.turn?.error && <p className="text-xs text-destructive">{m.turn.error}</p>}
              {m.turn && <HowIAnswered steps={m.turn.steps ?? []} done={m.turn.done || m.turn.answered} />}
              {m.turn && m.turn.tools.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.turn.tools.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                </div>
              )}
              {m.askId && cmp[m.askId] && (cmp[m.askId].status !== "done" || showCompareResult((cmp[m.askId] as { result: AskResult }).result, m.text, !!(m.turn?.done || m.turn?.answered), known)) && <CompareTable state={cmp[m.askId]} onPage={(doc, p) => dispatchViewer([{ doc, page: p - 1 }])} />}
              {(m.turn?.done || m.turn?.answered) && <CitationChips text={m.text} known={known} onPick={pick} shownPath={shownPath} />}
              {shownPath && m.turn?.done && extractCitations(m.text, known).some((c) => c.kind === "design" && c.path === shownPath) && (
                <p className="text-xs text-muted-foreground">Design doc: <code>{shownPath}</code></p>
              )}
            </div>
          ),
        )}
      </div>
      {messages.length > 0 && (
        <details className="border-t px-3 py-1.5 text-xs" data-testid="presenter-later" data-tour="presenter_questions">
          <summary className="cursor-pointer select-none font-medium">Presenter questions</summary>
          <div className="pt-1.5">{presenterChips(false)}</div>
        </details>
      )}
      <form
        className="flex gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input
          ref={inputEl}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask, or tell the agent what to show"
          aria-label="Message the Demo Agent"
          disabled={busy}
          dir="auto"
          maxLength={MAX_MESSAGE_CHARS}
          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
        />
        <Button type="submit" size="sm" disabled={busy || !input.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </section>
  )
}
