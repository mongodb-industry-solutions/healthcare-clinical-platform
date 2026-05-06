"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  fetchKedWorkflow,
  orderKedLabs,
  recordKedResults,
  generateKedFollowUpSummary,
  type KedWorkflowResponse,
  type FollowUpSummaryResponse,
} from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  Loader2,
  Sparkles,
  Stethoscope,
} from "lucide-react"
import { toast } from "sonner"
import { useDemo } from "@/lib/demo-context"
import { KedResultsDialog } from "./ked-results-dialog"
import { KedFollowUpSummary } from "./ked-follow-up-summary"

interface KedWorkflowCardProps {
  patientId: string
  careGaps: { hedis_measure: string; status: string }[]
  onWorkflowUpdated: () => void
}

export function KedWorkflowCard({
  patientId,
  careGaps,
  onWorkflowUpdated,
}: KedWorkflowCardProps) {
  const { bumpDataVersion } = useDemo()
  const [workflow, setWorkflow] = React.useState<KedWorkflowResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [actionLoading, setActionLoading] = React.useState(false)
  const [showResultsDialog, setShowResultsDialog] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const hasKedGap = careGaps.some((g) => g.hedis_measure === "KED")

  const loadWorkflow = React.useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchKedWorkflow(patientId)
      setWorkflow(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load KED workflow")
    } finally {
      setLoading(false)
    }
  }, [patientId])

  React.useEffect(() => {
    if (hasKedGap) {
      loadWorkflow()
    } else {
      setLoading(false)
    }
  }, [hasKedGap, loadWorkflow])

  if (!hasKedGap) return null
  if (loading) {
    return (
      <Card className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    )
  }
  if (error || !workflow) return null

  const status = workflow.workflow_status

  async function handleOrderLabs() {
    setActionLoading(true)
    try {
      await orderKedLabs(patientId)
      toast.success("Kidney evaluation labs ordered")
      await loadWorkflow()
      onWorkflowUpdated()
      bumpDataVersion()
    } catch (err) {
      toast.error("Failed to order labs", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setActionLoading(false)
    }
  }

  async function handleRecordResults(profile: "stable" | "abnormal" | "concerning") {
    setActionLoading(true)
    try {
      await recordKedResults(patientId, { result_profile: profile })
      toast.success("Kidney lab results recorded — KED gap closed")
      setShowResultsDialog(false)
      await loadWorkflow()
      onWorkflowUpdated()
      bumpDataVersion()
    } catch (err) {
      toast.error("Failed to record results", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setActionLoading(false)
    }
  }

  async function handleGenerateSummary() {
    setActionLoading(true)
    try {
      const summary = await generateKedFollowUpSummary(patientId)
      setWorkflow((prev) => (prev ? { ...prev, follow_up_summary: summary } : prev))
      toast.success("Follow-up summary generated")
      await loadWorkflow()
      onWorkflowUpdated()
      bumpDataVersion()
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
      <Card
        className={cn(
          "gap-0 py-3",
          status === "not_started" && "border-amber-200 dark:border-amber-800",
          status === "ordered" && "border-blue-200 dark:border-blue-800",
          status === "completed" && "border-emerald-200 dark:border-emerald-800",
        )}
      >
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="text-base font-medium flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            KED Intervention Workflow
          </p>
          <StatusBadge status={status} />
        </div>
        <div className="px-5 space-y-3">
          {/* ---- State: not_started ---- */}
          {status === "not_started" && (
            <>
              <div className="rounded-md border border-amber-200/50 bg-amber-50/30 p-2.5 dark:border-amber-800/50 dark:bg-amber-950/20">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">KED gap is open</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Annual kidney evaluation (eGFR + uACR) required for this
                      diabetic patient with CKD.
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Missing evidence:</span>{" "}
                {workflow.missing_evidence.join(", ")}
              </p>
              <Button
                onClick={handleOrderLabs}
                disabled={actionLoading}
                className="w-full"
                size="sm"
              >
                {actionLoading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                <Stethoscope className="mr-1.5 h-4 w-4" />
                Order Kidney Evaluation Labs
              </Button>
            </>
          )}

          {/* ---- State: ordered ---- */}
          {status === "ordered" && (
            <>
              <div className="rounded-md border border-blue-200/50 bg-blue-50/30 p-2.5 dark:border-blue-800/50 dark:bg-blue-950/20">
                <div className="flex items-start gap-2">
                  <ClipboardCheck className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Labs ordered — awaiting results</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Kidney evaluation labs have been ordered. Record simulated
                      results to complete the workflow.
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Required evidence:</span> eGFR, uACR
              </p>
              <Button
                onClick={() => setShowResultsDialog(true)}
                disabled={actionLoading}
                className="w-full"
                size="sm"
              >
                <FlaskConical className="mr-1.5 h-4 w-4" />
                Record Kidney Lab Results
              </Button>
            </>
          )}

          {/* ---- State: completed ---- */}
          {status === "completed" && (
            <>
              <div className="rounded-md border border-emerald-200/50 bg-emerald-50/30 p-2.5 dark:border-emerald-800/50 dark:bg-emerald-950/20">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">KED gap closed</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Both eGFR and uACR evidence received. Kidney evaluation
                      measure is now compliant.
                    </p>
                  </div>
                </div>
              </div>

              {workflow.follow_up_recommended && (
                <div className="rounded-md border border-amber-200/50 bg-amber-50/30 p-2.5 dark:border-amber-800/50 dark:bg-amber-950/20">
                  <div className="flex items-start gap-2">
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

          {/* Kidney labs */}
          {workflow.latest_kidney_labs.length > 0 && status === "completed" && (
            <div className="border-t pt-2.5">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Latest Kidney Labs
              </p>
              <div className="grid grid-cols-2 gap-2">
                {workflow.latest_kidney_labs.slice(0, 2).map((lab, i) => (
                  <div
                    key={i}
                    className="rounded-md border p-1.5 text-center"
                  >
                    <p className="text-[10px] text-muted-foreground truncate">
                      {String(lab.display ?? lab.loinc)}
                    </p>
                    <p
                      className={cn(
                        "text-base font-bold tabular-nums",
                        lab.interpretation === "L" && "text-amber-600",
                        lab.interpretation === "H" && "text-red-600",
                      )}
                    >
                      {String(lab.value)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {String(lab.unit)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Follow-up summary (rendered outside the main card) */}
      {workflow.follow_up_summary && <KedFollowUpSummary summary={workflow.follow_up_summary} />}

      {/* Results dialog */}
      <KedResultsDialog
        open={showResultsDialog}
        onOpenChange={setShowResultsDialog}
        onConfirm={handleRecordResults}
        loading={actionLoading}
      />
    </>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "not_started":
      return (
        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
          Open
        </Badge>
      )
    case "ordered":
      return (
        <Badge variant="outline" className="text-xs text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-700">
          Ordered
        </Badge>
      )
    case "completed":
      return (
        <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700">
          Completed
        </Badge>
      )
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>
  }
}
