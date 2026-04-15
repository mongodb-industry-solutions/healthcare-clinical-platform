"use client"

import * as React from "react"
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FlaskConical,
  TestTube,
  ArrowRight,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { CareGap } from "@/lib/mock-data"

interface CareGapWorkspaceLauncherProps {
  careGaps: CareGap[]
  activeGapMeasure: string | null
  onSelectGap: (measure: string) => void
}

const MEASURE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  KED: FlaskConical,
  "CDC-HBA": TestTube,
}

const MEASURE_DESCRIPTIONS: Record<string, string> = {
  KED: "Kidney Evaluation for Diabetes",
  "CDC-HBA": "Diabetes Care — HbA1c Testing",
}

export function CareGapWorkspaceLauncher({
  careGaps,
  activeGapMeasure,
  onSelectGap,
}: CareGapWorkspaceLauncherProps) {
  const sorted = React.useMemo(() => {
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    return [...careGaps].sort((a, b) => {
      if (a.status === "open" && b.status !== "open") return -1
      if (a.status !== "open" && b.status === "open") return 1
      return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
    })
  }, [careGaps])

  const openCount = careGaps.filter((g) => g.status === "open").length
  const closedCount = careGaps.filter((g) => g.status === "closed" && !g.follow_up?.recommended).length
  const followUpCount = careGaps.filter((g) => g.follow_up?.recommended).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Care Gap Interventions</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select a care gap to begin or continue intervention work
          </p>
        </div>
        <div className="flex items-center gap-2">
          {openCount > 0 && (
            <Badge variant="outline" className="text-[10px] h-5 border-amber-300 text-amber-700 dark:text-amber-400">
              {openCount} open
            </Badge>
          )}
          {followUpCount > 0 && (
            <Badge variant="outline" className="text-[10px] h-5 border-warning/40 text-warning">
              {followUpCount} follow-up
            </Badge>
          )}
          {closedCount > 0 && (
            <Badge variant="outline" className="text-[10px] h-5 border-emerald-300 text-emerald-700 dark:text-emerald-400">
              {closedCount} closed
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((gap) => (
          <CareGapTile
            key={gap.hedis_measure}
            gap={gap}
            isActive={activeGapMeasure === gap.hedis_measure}
            onSelect={() => onSelectGap(gap.hedis_measure)}
          />
        ))}
      </div>
    </div>
  )
}

function CareGapTile({
  gap,
  isActive,
  onSelect,
}: {
  gap: CareGap
  isActive: boolean
  onSelect: () => void
}) {
  const Icon = MEASURE_ICONS[gap.hedis_measure] ?? AlertCircle
  const description = MEASURE_DESCRIPTIONS[gap.hedis_measure] ?? gap.measure_name

  const isClosed = gap.status === "closed" && !gap.follow_up?.recommended
  const needsFollowUp = gap.status === "closed" && gap.follow_up?.recommended
  const isOverdue = gap.days_overdue > 0
  const isInProgress = gap.workflow_status === "ordered"

  const secondaryText = getCareGapSecondaryText(gap)
  const statusLabel = getCareGapStatusLabel(gap)

  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col gap-2 rounded-xl border-2 p-4 text-left transition-all duration-200",
        "hover:shadow-md hover:scale-[1.01]",
        isActive && "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20",
        !isActive && isClosed && "border-emerald-200 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/20",
        !isActive && needsFollowUp && "border-warning/40 bg-warning/5",
        !isActive && isOverdue && "border-destructive/40 bg-destructive/5",
        !isActive && !isClosed && !needsFollowUp && !isOverdue && "border-border bg-card hover:border-primary/40",
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              isActive && "bg-primary text-primary-foreground",
              !isActive && isClosed && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
              !isActive && needsFollowUp && "bg-warning/20 text-warning",
              !isActive && isOverdue && "bg-destructive/10 text-destructive",
              !isActive && !isClosed && !needsFollowUp && !isOverdue && "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{gap.hedis_measure}</p>
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          </div>
        </div>
        <StatusBadge
          label={statusLabel}
          isClosed={isClosed}
          needsFollowUp={needsFollowUp}
          isOverdue={isOverdue}
          isInProgress={isInProgress}
        />
      </div>

      {secondaryText && (
        <p className="text-xs text-muted-foreground leading-relaxed pl-[46px]">
          {secondaryText}
        </p>
      )}

      <div className={cn(
        "absolute right-3 bottom-3 transition-opacity",
        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-60",
      )}>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </button>
  )
}

function StatusBadge({
  label,
  isClosed,
  needsFollowUp,
  isOverdue,
  isInProgress,
}: {
  label: string
  isClosed?: boolean
  needsFollowUp?: boolean
  isOverdue?: boolean
  isInProgress?: boolean
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] shrink-0 h-5",
        isClosed && "border-emerald-300 text-emerald-700 dark:text-emerald-400 dark:border-emerald-700",
        needsFollowUp && "border-warning/40 text-warning",
        isOverdue && "border-destructive/40 text-destructive",
        isInProgress && "border-blue-300 text-blue-600 dark:text-blue-400 dark:border-blue-700",
        !isClosed && !needsFollowUp && !isOverdue && !isInProgress && "border-amber-300 text-amber-700 dark:text-amber-400",
      )}
    >
      {label}
    </Badge>
  )
}

function getCareGapStatusLabel(gap: CareGap) {
  if (gap.status === "closed" && gap.follow_up?.recommended) return "Follow-up needed"
  if (gap.status === "closed") return "Closed"
  if (gap.days_overdue > 0) return `${gap.days_overdue}d overdue`
  if (gap.workflow_status === "ordered") return "In progress"
  if (gap.closure_evidence?.missing?.length) {
    return gap.closure_evidence.missing.length === 1
      ? `${gap.closure_evidence.missing[0]} missing`
      : `${gap.closure_evidence.missing.length} items missing`
  }
  return "Due soon"
}

function getCareGapSecondaryText(gap: CareGap) {
  if (gap.status === "closed" && gap.follow_up?.recommended) {
    return gap.follow_up.reason ?? "Clinical review recommended after measure closure"
  }
  if (gap.workflow_status === "ordered") {
    return "Intervention workflow started and awaiting evidence"
  }
  if (gap.closure_evidence?.missing?.length) {
    return `Missing: ${gap.closure_evidence.missing.join(", ")}`
  }
  if (gap.days_overdue > 0) {
    return `Due by ${gap.due_by}`
  }
  return null
}
