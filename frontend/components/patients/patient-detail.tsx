"use client"

import * as React from "react"
import {
  AlertTriangle,
  Loader2,
  Plus,
  Pill,
  Database,
  GitBranch,
  Activity as ActivityIcon,
  ShieldCheck,
} from "lucide-react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import {
  fetchPatientFhirBundle,
  fetchPatientDetail,
  fetchPatientVitals,
  type PatientFhirBundleResponse,
  type PatientDetailResponse,
  type VitalsWithContextResponse,
} from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type Patient360, type VitalsTimeSeries } from "@/lib/mock-data"
import { DataModelToggleCard } from "@/components/mongodb/data-model-toggle-card"
import { MongodbActivityPanel } from "@/components/mongodb/mongodb-activity-panel"
import { Patient360EvolutionCard } from "@/components/mongodb/patient-360-evolution-card"
import { EncryptionComplianceCard } from "@/components/mongodb/encryption-compliance-card"
import { type ChartAnnotation } from "@/components/patients/vitals-chart"

import { PatientIdentityBar } from "./patient-identity-bar"
import { PatientDetailWorkspaceLayout } from "./patient-detail-workspace-layout"
import { ClinicalContextPanel } from "./clinical-context-panel"
import { CurrentVitalsPanel } from "./current-vitals-panel"
import { ClinicalConditionsStrip } from "./clinical-conditions-strip"
import { CareGapWorkspaceLauncher } from "./care-gap-workspace-launcher"
import { CareGapWorkspaceSurface, type ActiveSupportPanel } from "./care-gap-workspace-surface"
import { KedWorkflowWorkspace } from "./ked-workflow-workspace"
import { CdcHbaWorkflowWorkspace } from "./cdc-hba-workflow-workspace"

interface PatientDetailProps {
  patientId: string
}

type FhirBundleState = {
  status: "idle" | "loading" | "loaded" | "error"
  data: PatientFhirBundleResponse | null
  error: string | null
}

export function PatientDetail({ patientId }: PatientDetailProps) {
  const [detailData, setDetailData] = React.useState<PatientDetailResponse | null>(null)
  const [vitalsData, setVitalsData] = React.useState<VitalsWithContextResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [vitalsHours, setVitalsHours] = React.useState(24)
  const [annotations, setAnnotations] = React.useState<ChartAnnotation[]>([])
  const [showDataModelDialog, setShowDataModelDialog] = React.useState(false)
  const [showAnnotationDialog, setShowAnnotationDialog] = React.useState(false)
  const [annotationLabel, setAnnotationLabel] = React.useState("")
  const [annotationType, setAnnotationType] = React.useState<ChartAnnotation["type"]>("note")
  const [fhirBundleState, setFhirBundleState] = React.useState<FhirBundleState>({
    status: "idle",
    data: null,
    error: null,
  })

  const [activeGapMeasure, setActiveGapMeasure] = React.useState<string | null>(null)
  const [activeSupportPanel, setActiveSupportPanel] = React.useState<ActiveSupportPanel>("none")

  const reloadPatientData = React.useCallback(() => {
    return Promise.all([
      fetchPatientDetail(patientId),
      fetchPatientVitals(patientId, vitalsHours),
    ])
      .then(([detail, vitals]) => {
        setDetailData(detail)
        setVitalsData(vitals)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }, [patientId, vitalsHours])

  React.useEffect(() => {
    setLoading(true)
    reloadPatientData().finally(() => setLoading(false))
  }, [reloadPatientData])

  React.useEffect(() => {
    if (!detailData) return
    setAnnotations(buildAutoAnnotations(detailData.patient))
  }, [detailData])

  React.useEffect(() => {
    setFhirBundleState({ status: "idle", data: null, error: null })
  }, [patientId])

  const handleRequestFhirBundle = React.useCallback(() => {
    if (fhirBundleState.status === "loading" || fhirBundleState.status === "loaded") return

    setFhirBundleState({ status: "loading", data: null, error: null })

    fetchPatientFhirBundle(patientId)
      .then((response) => {
        setFhirBundleState({ status: "loaded", data: response, error: null })
      })
      .catch((err: Error) => {
        setFhirBundleState({ status: "error", data: null, error: err.message })
      })
  }, [fhirBundleState.status, patientId])

  const handleSelectGap = React.useCallback((measure: string) => {
    setActiveGapMeasure((prev) => (prev === measure ? null : measure))
    setActiveSupportPanel("none")
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !detailData) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Failed to load patient</p>
        <p className="text-xs text-destructive">{error}</p>
        <Button variant="outline" size="sm" asChild className="mt-2">
          <Link href="/patients">Back to patients</Link>
        </Button>
      </div>
    )
  }

  const patient = detailData.patient
  const {
    demographics,
    care_gaps,
    vitals_summary,
    active_alerts,
    flags,
    personalized_thresholds,
  } = patient

  const readings = (vitalsData?.readings ?? []) as VitalsTimeSeries[]
  const thresholds = vitalsData?.thresholds ?? personalized_thresholds
  const narrative = generateClinicalNarrative(patient)

  const activeGap = activeGapMeasure
    ? care_gaps.find((g) => g.hedis_measure === activeGapMeasure) ?? null
    : null

  const activeWorkflowKind: "ked" | "cdc-hba" | null = activeGap
    ? activeGap.hedis_measure === "KED"
      ? "ked"
      : activeGap.hedis_measure === "CDC-HBA"
        ? "cdc-hba"
        : null
    : null

  function handleAddAnnotation() {
    if (!annotationLabel.trim()) return
    const ts = vitals_summary?.latest.timestamp ?? new Date().toISOString()
    setAnnotations((prev) => [
      ...prev,
      { label: annotationLabel.trim(), timestamp: ts, type: annotationType },
    ])
    setAnnotationLabel("")
    setShowAnnotationDialog(false)
  }

  const workflowContent =
    activeWorkflowKind === "ked" ? (
      <KedWorkflowWorkspace
        patientId={patientId}
        careGaps={care_gaps}
        onWorkflowUpdated={reloadPatientData}
      />
    ) : activeWorkflowKind === "cdc-hba" ? (
      <CdcHbaWorkflowWorkspace
        patientId={patientId}
        careGaps={care_gaps}
        onWorkflowUpdated={reloadPatientData}
      />
    ) : null

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* ---- Identity bar ---- */}
      <PatientIdentityBar
        demographics={demographics}
        mrn={patient.mrn}
        hospitalName={patient.hospital_name}
        profileType={patient.profile_type}
        timeSinceLastAlert={detailData.time_since_last_alert}
        onOpenInsights={() => setShowDataModelDialog(true)}
      />

      {/* ---- Workspace shell ---- */}
      <PatientDetailWorkspaceLayout
        supportRail={
          <>
            <ClinicalContextPanel
              narrative={narrative}
              alerts={active_alerts}
            />
            {vitals_summary && (
              <CurrentVitalsPanel
                vitalsSummary={vitals_summary}
                thresholds={personalized_thresholds}
                flags={flags}
                onViewTrend={() => {
                  if (!activeGapMeasure) return
                  setActiveSupportPanel((prev) =>
                    prev === "vitals-trend" ? "none" : "vitals-trend",
                  )
                }}
              />
            )}
            <ClinicalConditionsStrip flags={flags} />
          </>
        }
        workspaceColumn={
          <div className="space-y-4">
            <CareGapWorkspaceLauncher
              careGaps={care_gaps}
              activeGapMeasure={activeGapMeasure}
              onSelectGap={handleSelectGap}
            />

            <CareGapWorkspaceSurface
              activeGap={activeGap}
              activeWorkflowKind={activeWorkflowKind}
              workflowContent={workflowContent}
              activeSupportPanel={activeSupportPanel}
              onSetSupportPanel={setActiveSupportPanel}
              readings={readings}
              thresholds={thresholds}
              vitalsHours={vitalsHours}
              onSetVitalsHours={setVitalsHours}
              annotations={annotations}
              onOpenAnnotationDialog={() => setShowAnnotationDialog(true)}
            />
          </div>
        }
      />

      {/* ---- MongoDB Insights dialog ---- */}
      <Dialog open={showDataModelDialog} onOpenChange={setShowDataModelDialog}>
        <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-5xl">
          <div className="flex max-h-[90vh] flex-col">
            <DialogHeader className="border-b px-6 py-5">
              <DialogTitle>MongoDB Insights</DialogTitle>
              <DialogDescription>
                Explore the data model, recent MongoDB activity, and Patient 360 evolution for this
                patient.
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-auto px-6 py-5">
              <Tabs defaultValue="data-model" className="gap-4">
                <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-xl border border-[#0f5f3d]/15 bg-[#0f5f3d]/5 p-1.5 md:grid-cols-4">
                  <TabsTrigger
                    value="data-model"
                    className="h-11 rounded-lg px-4 text-sm font-medium data-[state=active]:border-[#0f5f3d] data-[state=active]:bg-[#0f5f3d] data-[state=active]:text-white data-[state=active]:shadow-sm"
                  >
                    <Database className="h-4 w-4" />
                    Data Model
                  </TabsTrigger>
                  <TabsTrigger
                    value="mongodb-activity"
                    className="h-11 rounded-lg px-4 text-sm font-medium data-[state=active]:border-[#0f5f3d] data-[state=active]:bg-[#0f5f3d] data-[state=active]:text-white data-[state=active]:shadow-sm"
                  >
                    <ActivityIcon className="h-4 w-4" />
                    MongoDB Activity
                  </TabsTrigger>
                  <TabsTrigger
                    value="patient-360-evolution"
                    className="h-11 rounded-lg px-4 text-sm font-medium data-[state=active]:border-[#0f5f3d] data-[state=active]:bg-[#0f5f3d] data-[state=active]:text-white data-[state=active]:shadow-sm"
                  >
                    <GitBranch className="h-4 w-4" />
                    Patient 360 Evolution
                  </TabsTrigger>
                  <TabsTrigger
                    value="encryption-compliance"
                    className="h-11 rounded-lg px-4 text-sm font-medium data-[state=active]:border-[#0f5f3d] data-[state=active]:bg-[#0f5f3d] data-[state=active]:text-white data-[state=active]:shadow-sm"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Encryption &amp; Compliance
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="data-model" className="pt-2">
                  <DataModelToggleCard
                    patientId={patientId}
                    patient360={patient}
                    rawFhirBundle={fhirBundleState.data?.bundle ?? null}
                    fhirBundleStatus={fhirBundleState.status}
                    fhirBundleError={fhirBundleState.error}
                    onRequestFhirBundle={handleRequestFhirBundle}
                    variant="embedded"
                    jsonMaxHeightClassName="max-h-[52vh]"
                  />
                </TabsContent>

                <TabsContent value="mongodb-activity" className="pt-2">
                  <MongodbActivityPanel
                    scope="patient"
                    patientId={patientId}
                    patient={patient}
                    compact={false}
                    title="MongoDB Activity"
                  />
                </TabsContent>

                <TabsContent value="patient-360-evolution" className="pt-2">
                  <Patient360EvolutionCard
                    patientId={patientId}
                    patient={patient}
                    careGaps={care_gaps}
                    alerts={active_alerts}
                    workflowStatus={patient.interventions?.ked_workflow ?? null}
                    lastRefreshedAt={vitals_summary?.refreshed_at ?? null}
                  />
                </TabsContent>

                <TabsContent value="encryption-compliance" className="pt-2">
                  <EncryptionComplianceCard
                    patientId={patientId}
                    patient360={patient}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---- Annotation dialog ---- */}
      <Dialog open={showAnnotationDialog} onOpenChange={setShowAnnotationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Chart Annotation</DialogTitle>
            <DialogDescription>
              Mark a clinical event on the vitals chart (e.g., medication change, patient
              reported symptoms, procedure).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <div className="flex gap-2">
                {(
                  [
                    { value: "medication", label: "Medication change" },
                    { value: "event", label: "Clinical event" },
                    { value: "note", label: "Note" },
                  ] as const
                ).map((option) => (
                  <Button
                    key={option.value}
                    variant={annotationType === option.value ? "default" : "outline"}
                    size="sm"
                    className="h-8"
                    onClick={() => setAnnotationType(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                placeholder={
                  annotationType === "medication"
                    ? "e.g., Atenolol dose increased to 100 mg"
                    : annotationType === "event"
                      ? "e.g., Patient reported chest pain"
                      : "e.g., Discussed care plan with family"
                }
                value={annotationLabel}
                onChange={(e) => setAnnotationLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddAnnotation()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAnnotationDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddAnnotation} disabled={!annotationLabel.trim()}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Annotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Clinical narrative generator                                       */
/* ------------------------------------------------------------------ */

function generateClinicalNarrative(patient: Patient360): string {
  const { demographics, conditions, medications, flags, vitals_summary, active_alerts, labs } =
    patient
  const parts: string[] = []

  const conditionNames = conditions
    .filter((c) => c.clinical_status === "active")
    .map((c) => shortCondition(c.display))

  const intro =
    conditionNames.length > 0
      ? `${demographics.age}-year-old ${demographics.gender} with ${conditionNames.join(", ")}.`
      : `${demographics.age}-year-old ${demographics.gender} with no active chronic conditions.`
  parts.push(intro)

  const trendSignals: string[] = []
  const trend = vitals_summary.trend_24h
  if (trend.heart_rate === "increasing") trendSignals.push("HR trending up")
  if (trend.spo2 === "decreasing") trendSignals.push("SpO2 trending down")
  if (trend.respiratory_rate === "increasing") trendSignals.push("RR trending up")
  if (trend.temperature === "increasing") trendSignals.push("temp trending up")

  if (trendSignals.length > 0) {
    parts.push(`${trendSignals.join(", ")} over the past 24h.`)
  }

  const therapyNotes: string[] = []
  if (flags.has_beta_blocker) therapyNotes.push("beta-blocker therapy is active (HR threshold adjusted to 90 bpm)")
  if (flags.has_insulin) therapyNotes.push("insulin therapy with hypoglycemia monitoring")
  if (flags.has_ckd) therapyNotes.push("CKD baseline adjustments applied (SpO2 threshold 92%)")

  if (therapyNotes.length > 0) {
    parts.push(`${capitalize(therapyNotes[0])}${therapyNotes.length > 1 ? "; " + therapyNotes.slice(1).join("; ") : ""}.`)
  }

  if (active_alerts.length > 0) {
    const criticals = active_alerts.filter((a) => a.severity === "critical")
    if (criticals.length > 0) {
      parts.push(
        `${criticals.length} critical alert${criticals.length > 1 ? "s" : ""} active: ${criticals[0].title}.`,
      )
    }
  }

  const abnormalLabs = labs.filter(
    (l) => l.interpretation === "H" || l.interpretation === "HH" || l.interpretation === "L" || l.interpretation === "LL",
  )
  if (abnormalLabs.length > 0) {
    const labNames = abnormalLabs
      .slice(0, 3)
      .map((l) => `${l.display} ${l.value} ${l.unit}`)
    parts.push(`Notable labs: ${labNames.join(", ")}.`)
  }

  return parts.join(" ")
}

/* ------------------------------------------------------------------ */
/*  Auto-generate chart annotations from patient data                  */
/* ------------------------------------------------------------------ */

function buildAutoAnnotations(patient: Patient360): ChartAnnotation[] {
  const annotations: ChartAnnotation[] = []

  patient.medications
    .filter((med) => med.status === "active")
    .forEach((med) => {
      const drugName = med.display.split(" ")[0]
      annotations.push({
        label: `${drugName} ${med.dose} ${med.frequency}`,
        timestamp: patient.vitals_summary.latest.timestamp,
        type: "medication",
      })
    })

  return annotations
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shortCondition(display: string): string {
  const map: Record<string, string> = {
    "Type 2 diabetes mellitus": "T2DM",
    "Type 2 diabetes mellitus with hyperglycemia": "T2DM",
    "Chronic kidney disease stage 3": "CKD Stage 3",
    "Chronic kidney disease stage 4": "CKD Stage 4",
    "Essential hypertension": "HTN",
    "Peripheral neuropathy": "peripheral neuropathy",
    "Congestive heart failure": "CHF",
    "Atrial fibrillation": "A-fib",
    "Chronic obstructive pulmonary disease": "COPD",
  }
  return map[display] || display
}

function capitalize(value: string): string {
  if (!value) return value
  return `${value[0].toUpperCase()}${value.slice(1)}`
}
