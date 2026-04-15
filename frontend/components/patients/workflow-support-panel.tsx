"use client"

import { VitalsTrendSupport } from "./vitals-trend-support"
import type { ChartAnnotation } from "./vitals-chart"
import type { VitalsTimeSeries } from "@/lib/mock-data"
import type { ActiveSupportPanel } from "./care-gap-workspace-surface"

interface WorkflowSupportPanelProps {
  activeSupportPanel: ActiveSupportPanel
  readings: VitalsTimeSeries[]
  thresholds: Record<string, { low: number | null; high: number | null; source_rule: string | null }>
  vitalsHours: number
  onSetVitalsHours: (h: number) => void
  annotations: ChartAnnotation[]
  onOpenAnnotationDialog: () => void
}

export function WorkflowSupportPanel({
  activeSupportPanel,
  readings,
  thresholds,
  vitalsHours,
  onSetVitalsHours,
  annotations,
  onOpenAnnotationDialog,
}: WorkflowSupportPanelProps) {
  if (activeSupportPanel === "vitals-trend") {
    return (
      <VitalsTrendSupport
        readings={readings}
        thresholds={thresholds}
        vitalsHours={vitalsHours}
        onSetVitalsHours={onSetVitalsHours}
        annotations={annotations}
        onOpenAnnotationDialog={onOpenAnnotationDialog}
      />
    )
  }

  return null
}
