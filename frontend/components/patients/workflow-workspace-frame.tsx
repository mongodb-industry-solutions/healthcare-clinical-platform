"use client"

import * as React from "react"

import { WorkflowWorkspaceHeader } from "./workflow-workspace-header"
import type { CareGap } from "@/lib/mock-data"
import type { ActiveSupportPanel } from "./care-gap-workspace-surface"

interface WorkflowWorkspaceFrameProps {
  careGap: CareGap
  workflowTitle: string
  workflowStatus: string
  activeSupportPanel: ActiveSupportPanel
  onToggleSupportPanel: (panel: ActiveSupportPanel) => void
  children: React.ReactNode
}

export function WorkflowWorkspaceFrame({
  careGap,
  workflowTitle,
  workflowStatus,
  activeSupportPanel,
  onToggleSupportPanel,
  children,
}: WorkflowWorkspaceFrameProps) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <WorkflowWorkspaceHeader
        careGap={careGap}
        workflowTitle={workflowTitle}
        workflowStatus={workflowStatus}
        activeSupportPanel={activeSupportPanel}
        onToggleSupportPanel={onToggleSupportPanel}
      />
      <div className="p-4">{children}</div>
    </div>
  )
}
