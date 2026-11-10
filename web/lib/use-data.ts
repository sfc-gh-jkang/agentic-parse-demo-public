import data from "./use-data-snippets.json"

export type SnippetKind = "read" | "billed" | "pattern"
export interface Snippet { id: string; title: string; kind: SnippetKind; blurb: string; doc_link: keyof typeof data.doc_links; sql: string; input_sql?: string }

export const SNIPPETS = data.snippets as Snippet[]
export const DOC_LINKS = data.doc_links
const DOC_RE = /^[a-z0-9_]{1,64}$/

/** The snippet text for a Document: what the tab shows and what runs. Null for a bad Document id. */
export function renderSnippet(sql: string, doc: string): string | null {
  return DOC_RE.test(doc) ? sql.replaceAll("{doc}", doc) : null
}

/** OBJECT_SUFFIX (e.g. _T21) retargets the new objects at scratch copies for local testing; the shown text never changes. */
export function withSuffix(sql: string, suffix: string): string {
  return suffix ? sql.replace(/\bVISUAL_DATA_POINTS\b/g, `VISUAL_DATA_POINTS${suffix}`) : sql
}

/** Allowlist: only snippet ids of kind read/billed run, with a Document id that matches DOC_RE. */
export function runnableSql(id: string, doc: string, suffix = ""): { snippet: Snippet; sql: string } | null {
  const s = SNIPPETS.find((x) => x.id === id)
  if (!s || s.kind === "pattern") return null
  const sql = renderSnippet(s.sql, doc)
  return sql ? { snippet: s, sql: withSuffix(sql, suffix) } : null
}

/** About 4 characters per token for English text: a rough size for the confirm dialog, not a bill. */
export function approxTokens(chars: number): number {
  return Math.ceil(chars / 4)
}
