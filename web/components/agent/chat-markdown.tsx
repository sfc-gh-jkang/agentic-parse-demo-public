import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/** Agent answers are GitHub-flavoured markdown (tables, lists); styled like the parsed text panel. */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div dir="auto" className="parsed-markdown chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Never fetch an image named by an answer: a steered answer could point it at an outside URL with data in the query.
          img: ({ alt }) => <span className="text-muted-foreground">[image{alt ? `: ${alt}` : ""}]</span>,
          table: ({ node: _n, ...props }) => (
            <div className="table-scroll">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
