"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  fetchCdcHbaWorkflow,
  orderCdcHbaTest,
  recordCdcHbaResults,
  generateCdcHbaFollowUpSummary,
  type CdcHbaWorkflowResponse,
} from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Sparkles,
  Stethoscope,
  TestTube,
} from "lucide-react"
import { toast } from "sonner"
import { useDemo } from "@/lib/demo-context"
import { CdcHbaResultsDialog } from "./cdc-hba-results-dialog"
import { CdcHbaFollowUpSummary } from "./cdc-hba-follow-up-summary"

interface CdcHbaWorkflowWorkspaceProps {
  patientId: string
  careGaps: { hedis_measure: string; status: string }[]
  onWorkflowUpdated: () => void
}

export function CdcHbaWorkflowWorkspace({
  patientId,
  careGaps,
  onWorkflowUpdated,
}: CdcHbaWorkflowWorkspaceProps) {
  const { bumpDataVersion } = useDemo()
  const [workflow, setWorkflow] = React.useState<CdcHbaWorkflowResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [actionLoading, setActionLoading] = React.useState(false)
  const [showResultsDialog, setShowResultsDialog] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const hasCdcHbaGap = careGaps.some((g) => g.hedis_measure === "CDC-HBA")

  const loadWorkflow = React.useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchCdcHbaWorkflow(patientId)
      setWorkflow(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load CDC-HBA workflow")
    } finally {
      setLoading(false)
    }
  }, [patientId])

  React.useEffect(() => {
    if (hasCdcHbaGap) {
      loadWorkflow()
    } else {
      setLoading(false)
    }
  }, [hasCdcHbaGap, loadWorkflow])

  if (!hasCdcHbaGap) return null

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !workflow) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">Unable to load workflow</p>
      </div>
    )
  }

  const status = workflow.workflow_status

  async function handleOrderTest() {
    setActionLoading(true)
    try {
      await orderCdcHbaTest(patientId)
      toast.success("HbA1c test ordered")
      await loadWorkflow()
      onWorkflowUpdated()
      bumpDataVersion()
    } catch (err) {
      toast.error("Failed to order HbA1c test", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setActionLoading(false)
    }
  }

  async function handleRecordResults(profile: "controlled" | "elevated" | "concerning") {
    setActionLoading(true)
    try {
      await recordCdcHbaResults(patientId, { result_profile: profile })
      toast.success("HbA1c result recorded — CDC-HBA gap closed")
      setShowResultsDialog(false)
      await loadWorkflow()
      onWorkflowUpdated()
      bumpDataVersion()
    } catch (err) {
      toast.error("Failed to record HbA1c result", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setActionLoading(false)
    }
  }

  async function handleGenerateSummary() {
    setActionLoading(true)
    try {
      const summary = await generateCdcHbaFollowUpSummary(patientId)
      setWorkflow((prev) => (prev ? { ...prev, follow_up_summary: summary } : prev))
      toast.success("Follow-up summary generated")
      await loadWorkflow()
    } catch (err) {
      toast.error("Failed to generate summary", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        {status === "not_started" && (
          <>
            <div className="rounded-lg border border-amber-200/50 bg-amber-50/30 p-3 dark:border-amber-800/50 dark:bg-amber-950/20">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">CDC-HBA gap is open</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    HbA1c testing required for this diabetic patient within
                    the current measurement period.
                  </p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Missing evidence:</span>{" "}
              {workflow.missing_evidence.join(", ")}
            </p>
            <Button
              onClick={handleOrderTest}
              disabled={actionLoading}
              className="w-full"
              size="sm"
            >
              {actionLoading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              <Stethoscope className="mr-1.5 h-4 w-4" />
              Order HbA1c Test
            </Button>
          </>
        )}

        {status === "ordered" && (
          <>
            <div className="rounded-lg border border-blue-200/50 bg-blue-50/30 p-3 dark:border-blue-800/50 dark:bg-blue-950/20">
              <div className="flex items-start gap-2.5">
                <ClipboardCheck className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">HbA1c test ordered — awaiting result</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    HbA1c test has been ordered. Record the result to complete
                    the workflow.
                  </p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Required evidence:</span> HbA1c
            </p>
            <Button
              onClick={() => setShowResultsDialog(true)}
              disabled={actionLoading}
              className="w-full"
              size="sm"
            >
              <TestTube className="mr-1.5 h-4 w-4" />
              Record HbA1c Result
            </Button>
          </>
        )}

        {status === "completed" && (
          <>
            <div className="rounded-lg border border-emerald-200/50 bg-emerald-50/30 p-3 dark:border-emerald-800/50 dark:bg-emerald-950/20">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">CDC-HBA gap closed</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    HbA1c evidence received. Diabetes care HbA1c measure is
                    now compliant.
                  </p>
                </div>
              </div>
            </div>

            {workflow.follow_up_recommended && (
              <div className="rounded-lg border border-amber-200/50 bg-amber-50/30 p-3 dark:border-amber-800/50 dark:bg-amber-950/20">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Clinician follow-up recommended</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {workflow.follow_up_reason}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {workflow.follow_up_recommended && !workflow.follow_up_summary && (
              <Button
                variant="outline"
                onClick={handleGenerateSummary}
                disabled={actionLoading}
                className="w-full"
                size="sm"
              >
                {actionLoading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {!actionLoading && <Sparkles className="mr-1.5 h-4 w-4" />}
                Generate Clinician Review Summary
              </Button>
            )}
          </>
        )}

        {workflow.latest_hba1c_lab && status === "completed" && (
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Latest HbA1c Result</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-2 text-center">
                <p className="text-[10px] text-muted-foreground truncate">
                  {String(workflow.latest_hba1c_lab.display ?? workflow.latest_hba1c_lab.loinc)}
                </p>
                <p
                  className={cn(
                    "text-lg font-bold tabular-nums",
                    workflow.latest_hba1c_lab.interpretation === "H" && "text-amber-600",
                    workflow.latest_hba1c_lab.interpretation === "HH" && "text-red-600",
                  )}
                >
                  {String(workflow.latest_hba1c_lab.value)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {String(workflow.latest_hba1c_lab.unit)}
                </p>
              </div>
              <div className="rounded-lg border p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Target Range</p>
                <p className="text-lg font-bold tabular-nums text-emerald-600">&lt; 7.0</p>
                <p className="text-[10px] text-muted-foreground">%</p>
              </div>
            </div>
          </div>
        )}

        {workflow.follow_up_summary && (
          <CdcHbaFollowUpSummary summary={workflow.follow_up_summary} />
        )}
      </div>

      <CdcHbaResultsDialog
        open={showResultsDialog}
        onOpenChange={setShowResultsDialog}
        onConfirm={handleRecordResults}
        loading={actionLoading}
      />
    </>
  )
}
