"use client"

import * as React from "react"
import {
  AlertTriangle,
  ChevronRight,
  FileText,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { Patient360 } from "@/lib/mock-data"

interface ClinicalContextPanelProps {
  narrative: string
  alerts: Patient360["active_alerts"]
  onViewDetails?: () => void
}

export function ClinicalContextPanel({
  narrative,
  alerts,
  onViewDetails,
}: ClinicalContextPanelProps) {
  const criticalCount = alerts.filter((a) => a.severity === "critical").length
  const highCount = alerts.filter((a) => a.severity === "high").length
  const hasAlerts = alerts.length > 0

  const sorted = React.useMemo(
    () =>
      [...alerts].sort((a, b) => {
        const order: Record<string, number> = { critical: 0, high: 1, moderate: 2, medium: 2, low: 3 }
        return (order[a.severity] ?? 4) - (order[b.severity] ?? 4)
      }),
    [alerts],
  )

  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [highlightedId, setHighlightedId] = React.useState<string | null>(null)

  // Listen for the focus event dispatched by the linked-alert pill on a care
  // gap tile (Item 4). When the matching alert exists in this panel, we
  // expand it so the scrolled-to card is already showing its detail.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ alertId: string }>).detail
      if (!detail?.alertId) return
      if (!alerts.some((a) => a.alert_id === detail.alertId)) return
      setExpandedId(detail.alertId)
      setHighlightedId(detail.alertId)
      window.setTimeout(() => setHighlightedId(null), 1600)
    }
    window.addEventListener("cds-alert-focus", handler as EventListener)
    return () => window.removeEventListener("cds-alert-focus", handler as EventListener)
  }, [alerts])

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 space-y-3",
        criticalCount > 0 && "border-destructive/30",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Clinical Context</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {criticalCount > 0 && (
            <Badge variant="destructive" className="text-[10px] px-1.5 h-5">
              {criticalCount} critical
            </Badge>
          )}
          {highCount > 0 && (
            <Badge className="text-[10px] px-1.5 h-5 bg-warning text-warning-foreground">
              {highCount} high
            </Badge>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
        {narrative}
      </p>

      {hasAlerts && (
        <div className="space-y-1 pt-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Active Alerts
          </p>
          {sorted.slice(0, 4).map((alert) => {
            const isCritical = alert.severity === "critical"
            const isHigh = alert.severity === "high"
            const isExpanded = expandedId === alert.alert_id

            const isHighlighted = highlightedId === alert.alert_id
            return (
              <div
                key={alert.alert_id}
                id={`cds-alert-${alert.alert_id}`}
                className={cn(
                  "rounded-md border transition-all duration-300",
                  isCritical && "border-destructive/30 bg-destructive/5",
                  isHigh && "border-warning/30 bg-warning/5",
                  !isCritical && !isHigh && "border-border",
                  isHighlighted && "ring-2 ring-amber-400/70 ring-offset-1",
                )}
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : alert.alert_id)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      isCritical && "bg-destructive",
                      isHigh && "bg-warning",
                      !isCritical && !isHigh && "bg-muted-foreground",
                    )}
                  />
                  <span className="flex-1 truncate text-xs font-medium">{alert.title}</span>
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                      isExpanded && "rotate-90",
                    )}
                  />
                </button>
                {isExpanded && (
                  <div className="px-2.5 pb-2 pl-6">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {alert.reasoning}
                    </p>
                    {alert.suggested_actions?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {alert.suggested_actions.slice(0, 3).map((action, i) => (
                          <Badge key={i} variant="outline" className="text-[9px]">
                            {action}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {onViewDetails && (
        <button
          onClick={onViewDetails}
          className="flex items-center gap-1 text-xs text-primary hover:underline pt-1"
        >
          View full clinical details
          <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
