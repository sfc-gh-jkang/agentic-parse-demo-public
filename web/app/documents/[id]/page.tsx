import { DocumentViewer } from "@/components/documents/document-viewer"

export const dynamic = "force-dynamic"

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-4 sm:px-6 lg:px-8">
      <DocumentViewer docId={id} />
    </main>
  )
}
