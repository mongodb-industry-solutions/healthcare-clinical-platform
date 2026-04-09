"use client"

import { Activity, Database } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { Patient360 } from "@/lib/mock-data"
import {
  buildCareGapMongoActivity,
  buildDashboardMongoActivity,
  buildPatientMongoActivity,
  formatMongoRelativeTime,
  formatMongoTimestamp,
  getMongoCategoryLabel,
  type MongoActivityEvent,
} from "@/lib/mongodb-demo"
import { cn } from "@/lib/utils"

type MongodbActivityPanelProps = {
  title?: string
  scope: "dashboard" | "patient" | "care-gaps"
  patientId?: string
  patient?: Patient360
  patients?: Patient360[]
  compact?: boolean
}

export function MongodbActivityPanel({
  title = "MongoDB Activity",
  scope,
  patientId,
  patient,
  patients,
  compact = false,
}: MongodbActivityPanelProps) {
  const events = getEventsForScope({ scope, patient, patients }).slice(0, compact ? 4 : 6)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{getPanelDescription(scope, compact)}</CardDescription>
          </div>
          {patientId ? <Badge variant="outline">Patient ID: {patientId}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
            No recent operational activity is available for this view yet.
          </div>
        ) : (
          <div className={cn("space-y-4", compact && "space-y-3")}>
            {events.map((event, index) => (
              <div key={event.id}>
                <ActivityRow event={event} compact={compact} />
                {index < events.length - 1 ? <Separator className="mt-4" /> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ActivityRow({
  event,
  compact,
}: {
  event: MongoActivityEvent
  compact: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 rounded-full border bg-muted/30 p-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-transparent bg-[#0f5f3d] text-white hover:bg-[#0f5f3d]">
            {getMongoCategoryLabel(event.category)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatMongoRelativeTime(event.timestamp)}
          </span>
          {event.patientName && !compact ? (
            <span className="text-xs text-muted-foreground">{event.patientName}</span>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{event.title}</p>
          <Badge variant="outline" className="gap-1">
            <Database className="h-3 w-3" />
            {event.collection}
          </Badge>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">{formatMongoTimestamp(event.timestamp)}</p>
      </div>
    </div>
  )
}

function getEventsForScope({
  scope,
  patient,
  patients,
}: {
  scope: MongodbActivityPanelProps["scope"]
  patient?: Patient360
  patients?: Patient360[]
}) {
  switch (scope) {
    case "patient":
      return patient ? buildPatientMongoActivity(patient) : []
    case "care-gaps":
      return patients ? buildCareGapMongoActivity(patients) : []
    case "dashboard":
    default:
      return patients ? buildDashboardMongoActivity(patients) : []
  }
}

function getPanelDescription(
  scope: MongodbActivityPanelProps["scope"],
  compact: boolean,
) {
  if (scope === "patient") {
    return "Curated business events that show how operational state changed for this patient."
  }

  if (scope === "care-gaps") {
    return compact
      ? "Recent workflow and care-gap events that support compliance review."
      : "Operational changes tied to evidence, workflow, and care-gap closure."
  }

  return compact
    ? "Recent platform activity that demonstrates how MongoDB is driving the operational experience."
    : "Curated cross-patient events from ingestion through care-gap action."
}
