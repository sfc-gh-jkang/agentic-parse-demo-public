import { PageHeader } from "@/components/page-header"
import { HomeDashboard } from "@/components/documents/home-dashboard"
import { ResetDemoButton } from "@/components/documents/reset-demo-button"
import { PreviewBadge } from "@/components/preview-badge"

export const dynamic = "force-dynamic"

export default function Home() {
  return (
    <main id="top" className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <PageHeader
        eyebrow="AI_PARSE_DOCUMENT"
        title="Agentic Parse Demo"
        description="See what AI_PARSE_DOCUMENT OCR, LAYOUT and AGENTIC Parse Modes each make of the same Documents: charts, scans, forms and photos."
        actions={<><PreviewBadge /><ResetDemoButton /></>}
      />
      <HomeDashboard />
    </main>
  )
}
