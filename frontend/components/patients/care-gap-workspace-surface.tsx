"use client"

import * as React from "react"

import type { CareGap } from "@/lib/mock-data"
import { WorkspaceEmptyState } from "./workspace-empty-state"
import { WorkflowWorkspaceFrame } from "./workflow-workspace-frame"
import { WorkflowSupportPanel } from "./workflow-support-panel"
import type { ChartAnnotation } from "./vitals-chart"
import type { VitalsTimeSeries } from "@/lib/mock-data"

export type ActiveSupportPanel = "none" | "vitals-trend" | "alerts-detail" | "clinical-context"

interface CareGapWorkspaceSurfaceProps {
  activeGap: CareGap | null
  activeWorkflowKind: "ked" | "cdc-hba" | null
  workflowContent: React.ReactNode
  activeSupportPanel: ActiveSupportPanel
  onSetSupportPanel: (panel: ActiveSupportPanel) => void
  readings: VitalsTimeSeries[]
  thresholds: Record<string, { low: number | null; high: number | null; source_rule: string | null }>
  vitalsHours: number
  onSetVitalsHours: (h: number) => void
  annotations: ChartAnnotation[]
  onOpenAnnotationDialog: () => void
}

export function CareGapWorkspaceSurface({
  activeGap,
  activeWorkflowKind,
  workflowContent,
  activeSupportPanel,
  onSetSupportPanel,
  readings,
  thresholds,
  vitalsHours,
  onSetVitalsHours,
  annotations,
  onOpenAnnotationDialog,
}: CareGapWorkspaceSurfaceProps) {
  if (!activeGap || !activeWorkflowKind) {
    return <WorkspaceEmptyState />
  }

  const workflowTitle =
    activeWorkflowKind === "ked"
      ? "KED Intervention Workflow"
      : "CDC-HBA Intervention Workflow"

  return (
    <div className="space-y-4">
      <WorkflowWorkspaceFrame
        careGap={activeGap}
        workflowTitle={workflowTitle}
        workflowStatus={activeGap.workflow_status ?? "not_started"}
        activeSupportPanel={activeSupportPanel}
        onToggleSupportPanel={(panel) =>
          onSetSupportPanel(activeSupportPanel === panel ? "none" : panel)
        }
      >
        {workflowContent}
      </WorkflowWorkspaceFrame>

      {activeSupportPanel !== "none" && (
        <WorkflowSupportPanel
          activeSupportPanel={activeSupportPanel}
          readings={readings}
          thresholds={thresholds}
          vitalsHours={vitalsHours}
          onSetVitalsHours={onSetVitalsHours}
          annotations={annotations}
          onOpenAnnotationDialog={onOpenAnnotationDialog}
        />
      )}
    </div>
  )
}
