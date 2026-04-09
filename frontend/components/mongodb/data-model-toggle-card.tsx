"use client"

import * as React from "react"
import { Database, FileJson } from "lucide-react"

import { JsonTreeView } from "@/components/mongodb/json-tree-view"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Patient360 } from "@/lib/mock-data"
import { summarizeFhirBundle, summarizePatient360, type DataModelSummary } from "@/lib/mongodb-demo"

type DataModelToggleCardProps = {
  patientId: string
  patient360: Patient360
  rawFhirBundle: unknown | null
  fhirBundleStatus?: "idle" | "loading" | "loaded" | "error"
  fhirBundleError?: string | null
  onRequestFhirBundle?: () => void
  variant?: "card" | "embedded"
  jsonMaxHeightClassName?: string
}

export function DataModelToggleCard({
  patientId,
  patient360,
  rawFhirBundle,
  fhirBundleStatus = "loaded",
  fhirBundleError = null,
  onRequestFhirBundle,
  variant = "card",
  jsonMaxHeightClassName,
}: DataModelToggleCardProps) {
  const [selectedModel, setSelectedModel] = React.useState("patient-360")
  const fhirSummary = summarizeFhirBundle(rawFhirBundle)
  const patientSummary = summarizePatient360(patient360)

  const handleModelChange = (value: string) => {
    setSelectedModel(value)
    if (value === "fhir-bundle" && fhirBundleStatus === "idle") {
      onRequestFhirBundle?.()
    }
  }

  const content = (
    <Tabs value={selectedModel} onValueChange={handleModelChange} className="gap-4">
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
        {fhirBundleStatus === "loading" ? (
          <LoadingBundleState />
        ) : fhirBundleStatus === "error" ? (
          <ErrorBundleState message={fhirBundleError} onRetry={onRequestFhirBundle} />
        ) : fhirBundleStatus === "loaded" && rawFhirBundle ? (
          <>
            <SummaryStrip summary={fhirSummary} />
            <div className="space-y-1">
              <p className="text-sm font-medium">JSON Document</p>
              <p className="text-xs text-muted-foreground">
                Raw interoperable bundle returned on demand for source-level inspection.
              </p>
            </div>
            <JsonTreeView
              value={rawFhirBundle}
              defaultCollapsedDepth={99}
              maxHeightClassName={jsonMaxHeightClassName}
            />
          </>
        ) : fhirBundleStatus === "loaded" ? (
          <EmptyBundleState />
        ) : (
          <IdleBundleState />
        )}
      </TabsContent>

      <TabsContent value="patient-360" className="space-y-4">
        <SummaryStrip summary={patientSummary} />
        <div className="space-y-1">
          <p className="text-sm font-medium">JSON Document</p>
          <p className="text-xs text-muted-foreground">
            Operational patient document stored for workflow-ready clinical use.
          </p>
        </div>
        <JsonTreeView
          value={patient360}
          defaultCollapsedDepth={0}
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
        Raw source data is not available for this patient.
      </p>
    </div>
  )
}

function IdleBundleState() {
  return (
    <div className="rounded-lg border border-dashed px-5 py-8">
      <p className="text-sm font-medium">FHIR Bundle ready to load</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Open this view to load the raw interoperable bundle only when needed.
      </p>
    </div>
  )
}

function LoadingBundleState() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#0f5f3d]/15 bg-[#0f5f3d]/5 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0f5f3d] text-white">
            <Spinner className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium">Loading FHIR Bundle</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Retrieving the raw source document for this patient.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/15 p-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-20 rounded-md" />
          <Skeleton className="h-20 rounded-md" />
          <Skeleton className="h-20 rounded-md" />
          <Skeleton className="h-20 rounded-md" />
        </div>
      </div>

      <div className="rounded-lg border bg-background p-4">
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-11/12 rounded-lg" />
          <Skeleton className="h-10 w-10/12 rounded-lg" />
          <Skeleton className="h-10 w-9/12 rounded-lg" />
          <Skeleton className="h-10 w-8/12 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

function ErrorBundleState({
  message,
  onRetry,
}: {
  message?: string | null
  onRetry?: () => void
}) {
  return (
    <div className="rounded-lg border border-dashed px-5 py-8">
      <p className="text-sm font-medium">Unable to load FHIR Bundle</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {message ?? "An unexpected error occurred while loading the raw bundle."}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}
