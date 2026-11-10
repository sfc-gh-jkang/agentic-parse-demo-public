"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ScanSearch } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import type { Visual } from "@/lib/doc-utils"
import { cn } from "@/lib/utils"
import { visualKey, visualPlaceholderLabel } from "@/lib/viewer-utils"

/**
 * OCR is plain text; LAYOUT and AGENTIC return markdown. Markdown marks each image with
 * `![img-0.jpeg](img-0.jpeg)`, which is a position, not a loadable URL: render it as a chip
 * that selects the matching Visual's box on the Document.
 */
export function ParsedText({
  mode,
  content,
  visuals = [],
  selectedKey = null,
  onSelectVisual,
}: {
  mode: string
  content: string
  visuals?: Visual[]
  selectedKey?: string | null
  onSelectVisual?: (key: string) => void
}) {
  if (!content.trim()) {
    return <EmptyState title="No text on this page" description={`${mode} returned no text for this page.`} />
  }
  if (mode === "OCR") {
    return <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{content}</pre>
  }
  return (
    <div className="parsed-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node: _n, ...props }) => (
            <div className="table-scroll">
              <table {...props} />
            </div>
          ),
          img: ({ src, alt }) => {
            const id = String(alt || src || "")
            const visual = visuals.find((v) => v.visualId === id)
            const key = visual ? visualKey(visual) : null
            return (
              <button
                type="button"
                disabled={!visual || !onSelectVisual}
                onClick={() => key && onSelectVisual?.(key)}
                className={cn(
                  "my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs",
                  visual ? "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200"
                         : "border-dashed text-muted-foreground",
                  key && key === selectedKey && "ring-2 ring-amber-500",
                )}
              >
                <ScanSearch className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{visualPlaceholderLabel(visual, id, mode)}</span>
              </button>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
