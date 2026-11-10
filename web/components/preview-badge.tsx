import { RELEASE_NOTE_URL } from "@/lib/constants"

/** Release status per the 2026-10-28 release note (docs say "Public Preview"). */
export const PREVIEW_LABEL = "AGENTIC mode: Public Preview (released 2026-10-28)"

export function PreviewBadge() {
  return (
    <a
      href={RELEASE_NOTE_URL}
      target="_blank"
      rel="noreferrer"
      data-testid="preview-badge"
      className="inline-flex items-center rounded-full border border-amber-500 px-2.5 py-0.5 text-xs font-medium text-amber-900 hover:underline dark:text-amber-200"
    >
      {PREVIEW_LABEL}
    </a>
  )
}
