import type { TourStep } from "@/lib/app-actions"

/** The built-in guided tour: deterministic, no agent call, nothing billed. Storyline order (docs/talk-track.md). */
export const TOUR_STEPS: TourStep[] = [
  {
    target: "cost_stats", route: "home",
    caption: "Start here. These are the measured credits per 1,000 pages for each Parse Mode, from this account's real usage. AGENTIC costs more because it also reads charts and images.",
  },
  {
    target: "document_list",
    caption: "The Corpus. Every Document here was already parsed in all three Parse Modes (AGENTIC, LAYOUT, OCR) and scored against an answer key. Click any row to open it.",
  },
  {
    target: "score_strip", doc: "quarterly_report", page: 1, view: "one", mode: "AGENTIC",
    caption: "The score strip shows how many answer-key Facts each Parse Mode found. AGENTIC finds the numbers inside charts and images; LAYOUT and OCR mostly do not.",
  },
  {
    target: "visual_box",
    caption: "Amber boxes are Visuals (charts, photos, diagrams) that AGENTIC understood. Click one to see what it read.",
  },
  {
    target: "visual_detail", ui: "open_first_visual",
    caption: "This is what AGENTIC read from the first Visual on the page: a description and the values in it.",
  },
  {
    target: "compare_pair_tabs", view: "compare",
    caption: "Compare view puts AGENTIC next to LAYOUT or OCR on the same page, so you can see what the text-only parses leave out.",
  },
  {
    target: "chat_panel", ui: "chat_open",
    caption: "Ask the Demo Agent about any Document. Under each answer, How I answered lists the steps it took, in order. With Compare answers on, each answer also shows what each Parse Mode's text alone can answer.",
  },
  {
    target: "presenter_questions",
    caption: "These questions are the demo, in order. Click one and the agent answers in about 15 seconds, then moves the screen to the evidence.",
  },
  {
    target: "eval_button",
    caption: "Eval results shows the last test run of the agent: how many questions it passed and whether it called the right tools in the right order.",
  },
  {
    target: "value_panel", route: "home",
    caption: "What AGENTIC is worth, from stored data: measured credits against the facts each Parse Mode recovered, pages left to check by hand and cost per correct fact. Unfavourable numbers are shown too. Enter a monthly volume and your own review time and rate to see credits and review hours per Mode.",
  },
  {
    target: "use_data_tab", doc: "quarterly_report", ui: "open_data_tab",
    caption: "Every chart value AGENTIC read is now a row you can query. This tab has runnable SQL for the Document's pages, its visuals as rows, a Cortex Search query and an AI_EXTRACT example (billed, so it asks first).",
  },
  {
    target: "upload_card", route: "home",
    caption: "Last step. Upload your own PDF, image or Office file. It is parsed live in AGENTIC mode (a small AI-credit cost) and the Demo Agent can then answer questions about it.",
  },
]

export const WELCOME_KEY = "agentic-parse-demo:welcomed"

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** Once per browser (localStorage). If storage is blocked, count it as seen so the dialog never loops. */
export function hasSeenWelcome(store: KV): boolean {
  try {
    return store.getItem(WELCOME_KEY) === "1"
  } catch {
    return true
  }
}

export function markWelcomeSeen(store: KV): void {
  try {
    store.setItem(WELCOME_KEY, "1")
  } catch {
    /* blocked storage: nothing to remember */
  }
}

/** The tour asks the chat panel to open by this window event (the panel owns its open state). */
export const CHAT_OPEN_EVENT = "agentic-parse-demo:open-chat"
