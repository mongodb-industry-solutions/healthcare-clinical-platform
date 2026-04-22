"use client"

import * as React from "react"
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FlaskConical,
  History,
  TestTube,
  ArrowRight,
  CalendarDays,
  Stethoscope,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { CareGap, CareGapClosureEvent } from "@/lib/mock-data"
import {
  formatGapResultComponent,
  getEffectiveGapState,
} from "@/lib/care-gap-measures"

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
    // open > due_soon > anything else; ties broken by priority.
    const statusRank: Record<string, number> = { open: 0, due_soon: 1, closed: 2 }
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    return [...careGaps].sort((a, b) => {
      const sa = statusRank[a.status] ?? 3
      const sb = statusRank[b.status] ?? 3
      if (sa !== sb) return sa - sb
      return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
    })
  }, [careGaps])

  const openCount = careGaps.filter((g) => g.status === "open").length
  const dueSoonCount = careGaps.filter(
    (g) => getEffectiveGapState(g) === "due_soon",
  ).length
  const closedCount = careGaps.filter(
    (g) =>
      getEffectiveGapState(g) === "closed_controlled" && !g.follow_up?.recommended,
  ).length
  const followUpCount = careGaps.filter((g) => g.follow_up?.recommended).length
  const flaggedCount = careGaps.filter(
    (g) => getEffectiveGapState(g) === "closed_uncontrolled",
  ).length

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
          {flaggedCount > 0 && (
            <Badge variant="outline" className="text-[10px] h-5 border-amber-400 text-amber-700 dark:text-amber-400">
              {flaggedCount} flagged
            </Badge>
          )}
          {dueSoonCount > 0 && (
            <Badge variant="outline" className="text-[10px] h-5 border-blue-300 text-blue-700 dark:text-blue-400 dark:border-blue-700">
              {dueSoonCount} due soon
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

  const effectiveState = getEffectiveGapState(gap)
  const isControlledClosed = effectiveState === "closed_controlled" && !gap.follow_up?.recommended
  const isFlaggedClosed = effectiveState === "closed_uncontrolled"
  const isDueSoon = effectiveState === "due_soon"
  const needsFollowUp = gap.status === "closed" && gap.follow_up?.recommended
  const isOverdue = gap.status === "open" && gap.days_overdue > 0
  const isInProgress = gap.workflow_status === "ordered"

  const statusLabel = getCareGapStatusLabel(gap, effectiveState)

  // The tile uses a div with role="button" rather than a real <button>
  // because the "Linked alert" pill is itself an interactive element and
  // nesting buttons is invalid HTML.
  const handleSelect = () => onSelect()
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onSelect()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-2 rounded-xl border-2 p-4 text-left transition-all duration-200",
        "hover:shadow-md hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        isActive && "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20",
        !isActive && isControlledClosed && "border-emerald-200 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/20",
        !isActive && isFlaggedClosed && "border-amber-300 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/20",
        !isActive && isDueSoon && "border-blue-300 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20",
        !isActive && needsFollowUp && "border-warning/40 bg-warning/5",
        !isActive && isOverdue && "border-destructive/40 bg-destructive/5",
        !isActive && !isControlledClosed && !isFlaggedClosed && !isDueSoon && !needsFollowUp && !isOverdue && "border-border bg-card hover:border-primary/40",
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              isActive && "bg-primary text-primary-foreground",
              !isActive && isControlledClosed && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
              !isActive && isFlaggedClosed && "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
              !isActive && isDueSoon && "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
              !isActive && needsFollowUp && "bg-warning/20 text-warning",
              !isActive && isOverdue && "bg-destructive/10 text-destructive",
              !isActive && !isControlledClosed && !isFlaggedClosed && !isDueSoon && !needsFollowUp && !isOverdue && "bg-muted text-muted-foreground",
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
          isControlledClosed={isControlledClosed}
          isFlaggedClosed={isFlaggedClosed}
          isDueSoon={isDueSoon}
          needsFollowUp={needsFollowUp}
          isOverdue={isOverdue}
          isInProgress={isInProgress}
        />
      </div>

      <CareGapDetails gap={gap} />

      <LinkedAlertPills correlations={gap.correlated_alerts ?? []} />

      <ClosureHistoryPill history={gap.closure_history ?? []} />

      <div className={cn(
        "absolute right-3 bottom-3 transition-opacity",
        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-60",
      )}>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </div>
  )
}

const ALERT_PANEL_FOCUS_EVENT = "cds-alert-focus"

function focusLinkedAlert(alertId: string) {
  if (typeof window === "undefined") return
  // Notify the alerts panel so it can expand the matching row before the
  // scroll lands. The panel listens for this event in clinical-context-panel.
  window.dispatchEvent(
    new CustomEvent(ALERT_PANEL_FOCUS_EVENT, { detail: { alertId } }),
  )
  // Scroll on the next tick so the expanded layout is the target rect.
  requestAnimationFrame(() => {
    const el = document.getElementById(`cds-alert-${alertId}`)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  })
}

function LinkedAlertPills({
  correlations,
}: {
  correlations: NonNullable<CareGap["correlated_alerts"]>
}) {
  if (!correlations.length) return null
  return (
    <div className="flex flex-wrap gap-1 pl-[46px]">
      {correlations.map((corr) => (
        <button
          key={corr.alert_id}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            focusLinkedAlert(corr.alert_id)
          }}
          className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
          title={corr.reasoning}
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          <span>Linked alert: {corr.title}</span>
        </button>
      ))}
    </div>
  )
}

function ClosureHistoryPill({
  history,
}: {
  history: CareGapClosureEvent[]
}) {
  if (!history.length) return null
  const sorted = [...history].sort(
    (a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""),
  )
  return (
    <div className="pl-[46px]">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
          >
            <History className="h-2.5 w-2.5" />
            <span>
              View closure history{history.length > 1 ? ` (${history.length})` : ""}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 p-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-semibold">Closure audit trail</p>
            <p className="text-[10px] text-muted-foreground">
              Frozen at the moment the gap closed (DEQM §9)
            </p>
          </div>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {sorted.map((event, idx) => (
              <ClosureHistoryEntry key={`${event.workflow}-${event.closed_at}-${idx}`} event={event} />
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function ClosureHistoryEntry({ event }: { event: CareGapClosureEvent }) {
  const closedDate = formatDate(event.closed_at) ?? event.closed_at
  const closedBy = event.closed_by || "system"
  const evidenceLine = event.evidence_snapshot.length
    ? event.evidence_snapshot.join(" · ")
    : "No evidence captured"
  const controlled = event.result_evaluation?.controlled
  return (
    <li className="px-3 py-2 text-xs">
      <p className="font-medium">
        Closed by <span className="text-foreground">{closedBy}</span> on {closedDate}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{evidenceLine}</p>
      {controlled === false && event.result_evaluation && (
        <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="h-2.5 w-2.5" />
          Closed flagged: {event.result_evaluation.label}
        </p>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground">
        Source: {event.workflow}
      </p>
    </li>
  )
}

function StatusBadge({
  label,
  isControlledClosed,
  isFlaggedClosed,
  isDueSoon,
  needsFollowUp,
  isOverdue,
  isInProgress,
}: {
  label: string
  isControlledClosed?: boolean
  isFlaggedClosed?: boolean
  isDueSoon?: boolean
  needsFollowUp?: boolean
  isOverdue?: boolean
  isInProgress?: boolean
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] shrink-0 h-5",
        isControlledClosed && "border-emerald-300 text-emerald-700 dark:text-emerald-400 dark:border-emerald-700",
        isFlaggedClosed && "border-amber-400 text-amber-800 dark:text-amber-300 dark:border-amber-600",
        isDueSoon && "border-blue-300 text-blue-700 dark:text-blue-400 dark:border-blue-700",
        needsFollowUp && "border-warning/40 text-warning",
        isOverdue && "border-destructive/40 text-destructive",
        isInProgress && "border-blue-300 text-blue-600 dark:text-blue-400 dark:border-blue-700",
        !isControlledClosed && !isFlaggedClosed && !isDueSoon && !needsFollowUp && !isOverdue && !isInProgress && "border-amber-300 text-amber-700 dark:text-amber-400",
      )}
    >
      {label}
    </Badge>
  )
}

function getCareGapStatusLabel(gap: CareGap, state: ReturnType<typeof getEffectiveGapState>) {
  if (state === "closed_uncontrolled") return "Closed — flagged"
  if (state === "due_soon") {
    const days = gap.days_until_due ?? 0
    return days > 0 ? `Due in ${days}d` : "Due soon"
  }
  if (gap.status === "closed" && gap.follow_up?.recommended) return "Follow-up needed"
  if (gap.status === "closed") return "Closed"
  if (gap.days_overdue > 0) return `${gap.days_overdue}d overdue`
  if (gap.workflow_status === "ordered") return "In progress"
  if (gap.evidence?.missing?.length) {
    return gap.evidence.missing.length === 1
      ? `${gap.evidence.missing[0]}`
      : `${gap.evidence.missing.length} items missing`
  }
  return "Due soon"
}

function formatPeriod(period: string | null | undefined): string | null {
  if (!period) return null
  const [start, end] = period.split("/")
  if (!start || !end) return null
  const fmt = (d: string) => {
    try {
      return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    } catch {
      return d
    }
  }
  return `${fmt(start)} – ${fmt(end)}`
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
  } catch {
    return iso
  }
}

function CareGapDetails({ gap }: { gap: CareGap }) {
  const lines: { icon: React.ComponentType<{ className?: string }>; text: string; muted?: boolean }[] = []
  const state = getEffectiveGapState(gap)

  if (state === "closed_uncontrolled" && gap.result_evaluation) {
    // Result-based gap: show each component (met / failed) on its own line so
    // the clinician sees exactly which value drove the flag.
    gap.result_evaluation.components.forEach((component) => {
      lines.push({
        icon: component.met ? CheckCircle2 : AlertCircle,
        text: formatGapResultComponent(component),
        muted: component.met,
      })
    })
  } else if (gap.status === "closed" && gap.follow_up?.recommended) {
    lines.push({
      icon: AlertCircle,
      text: gap.follow_up.reason ?? "Clinical review recommended after measure closure",
    })
  } else if (gap.workflow_status === "ordered") {
    lines.push({ icon: Clock, text: "Intervention workflow started — awaiting evidence" })
  } else if (gap.reason) {
    lines.push({ icon: AlertCircle, text: gap.reason })
  }

  // Don't double-render evidence.found for flagged gaps — the result_evaluation
  // components above already cover the "what was measured" story.
  if (gap.evidence?.found?.length && state !== "closed_uncontrolled") {
    lines.push({
      icon: CheckCircle2,
      text: gap.evidence.found.join("; "),
      muted: true,
    })
  }

  // Recommended action shows for any actionable state: open, due_soon, and
  // flagged-closed (where the engine swapped in the result-driven follow-up).
  if (
    gap.recommended_action &&
    (gap.status === "open" || state === "due_soon" || state === "closed_uncontrolled")
  ) {
    lines.push({ icon: Stethoscope, text: gap.recommended_action })
  }

  const period = formatPeriod(gap.measurement_period)
  const lastDone = formatDate(gap.last_completed)

  if (period || lastDone) {
    const parts: string[] = []
    if (period) parts.push(`Period: ${period}`)
    if (lastDone) parts.push(`Last: ${lastDone}`)
    lines.push({ icon: CalendarDays, text: parts.join(" · "), muted: true })
  }

  if (!lines.length) return null

  return (
    <div className="flex flex-col gap-1 pl-[46px]">
      {lines.map((line, i) => {
        const LineIcon = line.icon
        return (
          <div key={i} className="flex items-start gap-1.5">
            <LineIcon className={cn(
              "h-3 w-3 mt-0.5 shrink-0",
              line.muted ? "text-muted-foreground/60" : "text-muted-foreground",
            )} />
            <p className={cn(
              "text-[11px] leading-relaxed",
              line.muted ? "text-muted-foreground/70" : "text-muted-foreground",
            )}>
              {line.text}
            </p>
          </div>
        )
      })}
    </div>
  )
}

