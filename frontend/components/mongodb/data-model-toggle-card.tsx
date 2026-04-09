"use client"

import { Database, FileJson } from "lucide-react"

import { JsonTreeView } from "@/components/mongodb/json-tree-view"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Patient360 } from "@/lib/mock-data"
import { summarizeFhirBundle, summarizePatient360, type DataModelSummary } from "@/lib/mongodb-demo"

type DataModelToggleCardProps = {
  patientId: string
  patient360: Patient360
  rawFhirBundle: unknown | null
  variant?: "card" | "embedded"
  jsonMaxHeightClassName?: string
}

export function DataModelToggleCard({
  patientId,
  patient360,
  rawFhirBundle,
  variant = "card",
  jsonMaxHeightClassName,
}: DataModelToggleCardProps) {
  const fhirSummary = summarizeFhirBundle(rawFhirBundle)
  const patientSummary = summarizePatient360(patient360)
  const content = (
    <Tabs defaultValue="patient-360" className="gap-4">
      <TabsList>
        <TabsTrigger value="fhir-bundle">
          <FileJson className="h-4 w-4" />
          FHIR Bundle
        </TabsTrigger>
        <TabsTrigger value="patient-360">
          <Database className="h-4 w-4" />
          Patient 360
        </TabsTrigger>
      </TabsList>

      <TabsContent value="fhir-bundle" className="space-y-4">
        <SummaryStrip summary={fhirSummary} />
        {rawFhirBundle ? (
          <JsonTreeView
            value={rawFhirBundle}
            defaultCollapsedDepth={2}
            maxHeightClassName={jsonMaxHeightClassName}
          />
        ) : (
          <EmptyBundleState />
        )}
      </TabsContent>

      <TabsContent value="patient-360" className="space-y-4">
        <SummaryStrip summary={patientSummary} />
        <JsonTreeView
          value={patient360}
          defaultCollapsedDepth={2}
          maxHeightClassName={jsonMaxHeightClassName}
        />
      </TabsContent>
    </Tabs>
  )

  if (variant === "embedded") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Compare raw interoperable records with the operational patient document used for alerts,
            workflow, and care-gap action.
          </p>
          <Badge variant="outline">Patient ID: {patientId}</Badge>
        </div>
        {content}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle>Clinical Data Model</CardTitle>
            <CardDescription>
              Compare raw interoperable records with the operational patient document used for
              alerts, workflow, and care-gap action.
            </CardDescription>
          </div>
          <Badge variant="outline">Patient ID: {patientId}</Badge>
        </div>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}

function SummaryStrip({ summary }: { summary: DataModelSummary }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">{summary.label}</p>
        <p className="text-sm text-muted-foreground">{summary.description}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.metrics.map((metric) => (
          <div key={metric.label} className="rounded-md border bg-background/80 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {metric.label}
            </p>
            <p className="mt-1 text-sm font-medium">{metric.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyBundleState() {
  return (
    <div className="rounded-lg border border-dashed px-5 py-8">
      <p className="text-sm font-medium">FHIR Bundle unavailable</p>
      <p className="mt-1 text-sm text-muted-foreground">
        The current patient detail response does not yet expose raw bundle payloads. This card is
        ready to render them when that contract is added.
      </p>
    </div>
  )
}
