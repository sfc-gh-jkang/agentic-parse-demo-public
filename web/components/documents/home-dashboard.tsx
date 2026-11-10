"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { FileText, Layers, Gauge } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ValuePanel } from "@/components/value/value-panel"
import { UploadCard } from "@/components/documents/upload-card"
import { EmptyState } from "@/components/empty-state"
import { StatCard, StatCardSkeleton } from "@/components/stat-card"
import { fetchJson, prettifyDocId, PARSE_MODES, type DocumentSummary, type ModeCost } from "@/lib/doc-utils"
import { formatNumber, formatRelative } from "@/lib/format"

function CostStat({ mode, costs }: { mode: string; costs: ModeCost[] }) {
  const c = costs.find((m) => m.mode === mode)
  const value =
    c?.creditsPer1kPages != null ? `${formatNumber(c.creditsPer1kPages, 2)} credits` : "pending"
  const hint = c?.creditsPer1kPages != null ? "per 1k pages, measured on this account" : "usage telemetry has not reported yet"
  return <StatCard label={`${mode} AI credits / 1k pages`} value={value} hint={hint} icon={Gauge} />
}

export function HomeDashboard() {
  const docs = useQuery({ queryKey: ["documents"], queryFn: () => fetchJson<{ documents: DocumentSummary[] }>("/api/documents") })
  const cost = useQuery({ queryKey: ["cost"], queryFn: () => fetchJson<{ modes: ModeCost[] }>("/api/cost") })

  const documents = docs.data?.documents ?? []
  const totalPages = documents.reduce((n, d) => n + (d.pages ?? 0), 0)

  return (
    <>
      <section data-tour="cost_stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {docs.isPending ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : docs.isError ? null : (
          <>
            <StatCard label="Documents in Corpus" value={documents.filter((d) => d.source !== "upload").length} icon={FileText} hint="Synthetic, reproducible" />
            <StatCard label="Pages" value={totalPages} icon={Layers} hint="Across all Documents" />
          </>
        )}
        {cost.isPending ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : cost.isError ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <EmptyState variant="error" title="Could not load measured cost" description={cost.error.message} />
          </div>
        ) : (
          ["AGENTIC", "LAYOUT", "OCR"].map((m) => <CostStat key={m} mode={m} costs={cost.data.modes} />)
        )}
      </section>

      <UploadCard />

      <Card data-tour="document_list">
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {docs.isPending ? (
            <div className="space-y-3 p-6">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : docs.isError ? (
            <div className="p-6">
              <EmptyState variant="error" title="Could not load Documents" description={docs.error.message} />
            </div>
          ) : documents.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No Documents yet" description="Run the Corpus load to register Documents." />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead numeric>Pages</TableHead>
                  <TableHead>Parse Modes parsed</TableHead>
                  <TableHead>Last parsed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((d) => (
                  <TableRow key={d.docId}>
                    <TableCell className="font-medium">
                      <Link href={`/documents/${d.docId}`} className="text-primary hover:underline">
                        {prettifyDocId(d.docId)}
                      </Link>
                      {d.source === "upload" && <Badge variant="secondary" className="ml-2">Uploaded</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="uppercase">{d.fileType}</Badge>
                    </TableCell>
                    <TableCell numeric>{d.pages ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {PARSE_MODES.map((m) =>
                          d.modesParsed.includes(m) ? (
                            <Badge key={m} variant="success">{m}</Badge>
                          ) : null,
                        )}
                        {d.modesParsed.length === 0 && <span className="text-muted-foreground">none</span>}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(d.lastParsedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ValuePanel />
    </>
  )
}
