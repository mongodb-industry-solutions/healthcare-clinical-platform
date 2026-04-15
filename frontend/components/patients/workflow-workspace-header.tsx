"use client"

import {
  FlaskConical,
  TestTube,
  LineChart,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { CareGap } from "@/lib/mock-data"
import type { ActiveSupportPanel } from "./care-gap-workspace-surface"

const MEASURE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  KED: FlaskConical,
  "CDC-HBA": TestTube,
}

interface WorkflowWorkspaceHeaderProps {
  careGap: CareGap
  workflowTitle: string
  workflowStatus: string
  activeSupportPanel: ActiveSupportPanel
  onToggleSupportPanel: (panel: ActiveSupportPanel) => void
}

export function WorkflowWorkspaceHeader({
  careGap,
  workflowTitle,
  workflowStatus,
  activeSupportPanel,
  onToggleSupportPanel,
}: WorkflowWorkspaceHeaderProps) {
  const Icon = MEASURE_ICONS[careGap.hedis_measure] ?? FlaskConical

  return (
    <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{workflowTitle}</h3>
            <WorkflowStatusBadge status={workflowStatus} />
          </div>
          <p className="text-xs text-muted-foreground">
            {careGap.hedis_measure} — {careGap.measure_name}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant={activeSupportPanel === "vitals-trend" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => onToggleSupportPanel("vitals-trend")}
        >
          <LineChart className="h-3 w-3" />
          Vitals Trend
        </Button>
      </div>
    </div>
  )
}

function WorkflowStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "not_started":
      return (
        <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
          Open
        </Badge>
      )
    case "ordered":
      return (
        <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-700">
          Ordered
        </Badge>
      )
    case "completed":
      return (
        <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700">
          Completed
        </Badge>
      )
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>
  }
}
