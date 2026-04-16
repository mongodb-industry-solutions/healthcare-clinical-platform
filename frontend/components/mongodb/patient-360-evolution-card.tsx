"use client"

import * as React from "react"
import { ArrowRight, GitBranch } from "lucide-react"

import { DocumentSnapshotDiff } from "@/components/mongodb/document-snapshot-diff"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Patient360 } from "@/lib/mock-data"
import {
  buildPatientEvolution,
  formatMongoTimestamp,
  type EvolutionMilestone,
} from "@/lib/mongodb-demo"
import { cn } from "@/lib/utils"

type Patient360EvolutionCardProps = {
  patientId: string
  patient: Patient360
  careGaps: Patient360["care_gaps"]
  alerts: Patient360["active_alerts"]
  workflowStatus?: unknown
  lastRefreshedAt?: string | null
}

export function Patient360EvolutionCard({
  patientId,
  patient,
  careGaps,
  alerts,
  workflowStatus,
  lastRefreshedAt,
}: Patient360EvolutionCardProps) {
  const milestones = React.useMemo(
    () =>
      buildPatientEvolution(patient, {
        alerts,
        careGaps,
        workflowStatus,
        lastRefreshedAt,
      }),
    [alerts, careGaps, lastRefreshedAt, patient, workflowStatus],
  )

  const [selectedId, setSelectedId] = React.useState<string | null>(milestones.at(0)?.id ?? null)

  React.useEffect(() => {
    setSelectedId((current) => {
      if (!milestones.length) return null
      if (current && milestones.some((milestone) => milestone.id === current)) return current
      return milestones.at(0)?.id ?? null
    })
  }, [milestones])

  const selectedMilestone =
    milestones.find((milestone) => milestone.id === selectedId) ?? milestones.at(0) ?? null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle>Patient 360 Evolution</CardTitle>
            <CardDescription>
              Milestone-based document updates that show how clinical data becomes workflow-ready
              operational state.
            </CardDescription>
          </div>
          <Badge variant="outline">Patient ID: {patientId}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {milestones.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
            No enrichment milestones are available for this patient yet.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <ScrollArea className="max-h-[28rem] rounded-lg border bg-muted/15">
              <div className="space-y-2 p-3">
                {milestones.map((milestone) => (
                  <MilestoneButton
                    key={milestone.id}
                    milestone={milestone}
                    active={milestone.id === selectedMilestone?.id}
                    onClick={() => setSelectedId(milestone.id)}
                  />
                ))}
              </div>
            </ScrollArea>

            {selectedMilestone ? (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-medium">{selectedMilestone.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatMongoTimestamp(selectedMilestone.timestamp)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {selectedMilestone.description}
                  </p>
                </div>

                <DocumentSnapshotDiff
                  before={selectedMilestone.documentBefore}
                  after={selectedMilestone.documentAfter}
                />
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MilestoneButton({
  milestone,
  active,
  onClick,
}: {
  milestone: EvolutionMilestone
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors hover:bg-background",
        active
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-background/70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{milestone.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatMongoTimestamp(milestone.timestamp)}
          </p>
        </div>
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </button>
  )
}
