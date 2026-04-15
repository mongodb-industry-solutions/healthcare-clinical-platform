"use client"

import * as React from "react"
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  ChevronRight,
  ClipboardList,
  HeartPulse,
  Layers,
  Loader2,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { JsonTreeView } from "@/components/mongodb/json-tree-view"
import { useDemo } from "@/lib/demo-context"
import {
  fetchAllPatients,
  fetchCDSCards,
  fetchCDSProvenance,
  type CDSCard,
  type CDSProvenanceResponse,
} from "@/lib/api"
import { useSimulation, type AlertNotification, type LiveReading } from "@/lib/simulation-context"
import {
  getCareGapMeasureDashboardLabel,
} from "@/lib/care-gap-measures"
import { type Alert as PatientAlert, type CareGap, type Patient360 } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

const ALERT_WINDOW_MS = 5 * 60 * 1000

const VITAL_CONFIG = {
  heart_rate: { label: "HR", unit: "bpm" },
  respiratory_rate: { label: "RR", unit: "br/min" },
  spo2: { label: "SpO2", unit: "%" },
  temperature: { label: "Temp", unit: "C" },
} as const

type Severity = "critical" | "high" | "moderate" | "medium" | "low"
type VitalKey = keyof typeof VITAL_CONFIG

type CurrentReading = {
  timestamp: string
  heart_rate: number
  respiratory_rate: number
  temperature: number
  spo2: number
  activity_level: number
  event: string | null
}

type ThresholdBreach = {
  vital: VitalKey
  direction: "above" | "below"
  threshold: number
  current: number
}

type EscalationCandidate = {
  patient: Patient360
  score: number
  topGap: CareGap | null
  primaryAlert: PatientAlert | null
  liveReading: CurrentReading
  liveSignals: string[]
  thresholdBreaches: ThresholdBreach[]
  overdueGapCount: number
  recentAlertCount: number
  eventLabel: string | null
  measurePressureScore: number
  livePressureScore: number
  contextPressureScore: number
  alertPressureScore: number
}

type ClinicalSummaryMetrics = {
  contextElevatedGapCount: number
  interventionPatientCount: number
  pressuredMeasureCount: number
  pressuredMeasureLabels: string[]
}

type CardTrend = {
  direction: "up" | "down" | "neutral"
  value: number
  label: string
  format?: "delta" | "plain"
}

type QueueSummary = {
  contextElevatedGaps: number
  escalatedCount: number
  measureCount: number
  queueCount: number
  nextLabel: string
  nextReason: string
}

export function DashboardOverview() {
  const { dataVersion } = useDemo()
  const { isRunning, liveReadings, recentAlerts } = useSimulation()
  const [patients, setPatients] = React.useState<Patient360[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (patients.length === 0) setLoading(true)
    fetchAllPatients({ limit: 500 })
      .then((data) => {
        setPatients(data)
        setError(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [dataVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const liveReadingsList = React.useMemo(
    () => Array.from(liveReadings.values()),
    [liveReadings],
  )

  const rankedEscalations = React.useMemo(
    () => rankEscalationPatients(patients, liveReadings, recentAlerts),
    [patients, liveReadings, recentAlerts],
  )
  const clinicalSummary = React.useMemo(
    () => buildClinicalSummaryMetrics(patients, liveReadings, recentAlerts, rankedEscalations),
    [patients, liveReadings, recentAlerts, rankedEscalations],
  )
  const [selectedPriorityPatientId, setSelectedPriorityPatientId] = React.useState<string | null>(null)
  const [isPrioritySheetOpen, setIsPrioritySheetOpen] = React.useState(false)

  React.useEffect(() => {
    if (!selectedPriorityPatientId) {
      if (rankedEscalations.length === 0 && isPrioritySheetOpen) {
        setIsPrioritySheetOpen(false)
      }
      return
    }

    const selectedStillExists = rankedEscalations.some(
      (candidate) => candidate.patient.patient_id === selectedPriorityPatientId,
    )

    if (!selectedStillExists) {
      setSelectedPriorityPatientId(null)
      setIsPrioritySheetOpen(false)
    }
  }, [isPrioritySheetOpen, rankedEscalations, selectedPriorityPatientId])

  const queueCandidates = rankedEscalations

  const selectedCandidate = React.useMemo(
    () =>
      selectedPriorityPatientId
        ? rankedEscalations.find((candidate) => candidate.patient.patient_id === selectedPriorityPatientId) ?? null
        : null,
    [rankedEscalations, selectedPriorityPatientId],
  )

  const queueSummary = React.useMemo<QueueSummary>(() => {
    const nextCandidate = queueCandidates[0] ?? null
    const distinctMeasures = new Set(
      queueCandidates
        .map((candidate) => candidate.topGap?.hedis_measure)
        .filter((measure): measure is string => Boolean(measure)),
    )

    return {
      contextElevatedGaps: clinicalSummary.contextElevatedGapCount,
      escalatedCount: queueCandidates.filter((candidate) => isImmediateReviewCandidate(candidate)).length,
      measureCount: distinctMeasures.size,
      queueCount: queueCandidates.length,
      nextLabel: nextCandidate ? nextCandidate.patient.demographics.name : "Queue is clear",
      nextReason: nextCandidate
        ? getCandidateReasonLine(nextCandidate)
        : "No active intervention cases are waiting for review.",
    }
  }, [clinicalSummary.contextElevatedGapCount, queueCandidates])

  const openPriorityIntervention = React.useCallback((patientId: string) => {
    setSelectedPriorityPatientId(patientId)
    setIsPrioritySheetOpen(true)
  }, [])

  const closePriorityIntervention = React.useCallback(() => {
    setIsPrioritySheetOpen(false)
    setSelectedPriorityPatientId(null)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Failed to load dashboard data</p>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Clinical Quality Operations</h1>
        <p className="text-sm text-muted-foreground">
          Identify which care gaps need intervention now based on HEDIS risk, live context, and CDS guidance.
        </p>
      </div>

      <div className="mx-auto w-full max-w-[1400px]">
        <ReviewQueueCard
          candidates={queueCandidates}
          selectedPatientId={isPrioritySheetOpen ? selectedPriorityPatientId : null}
          summary={queueSummary}
          onOpenPatient={openPriorityIntervention}
        />
      </div>

      <Sheet
        open={isPrioritySheetOpen && selectedCandidate !== null}
        onOpenChange={(open) => {
          if (!open) closePriorityIntervention()
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto border-l border-[#D6E8DD] bg-[#F4FAF6] p-0 sm:max-w-4xl"
        >
          <SheetTitle className="sr-only">
            {selectedCandidate
              ? `Priority Intervention for ${selectedCandidate.patient.demographics.name}`
              : "Priority Intervention"}
          </SheetTitle>
          {selectedCandidate ? (
            <div className="min-h-full bg-[radial-gradient(circle_at_top,_rgba(15,95,61,0.08),_transparent_38%)]">
              <TopEscalationCard candidate={selectedCandidate} presentation="sheet" />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function TopEscalationCard({
  candidate,
  presentation = "card",
}: {
  candidate: EscalationCandidate | null
  presentation?: "card" | "sheet"
}) {
  const [cdsCards, setCdsCards] = React.useState<CDSCard[]>([])
  const [cdsLoading, setCdsLoading] = React.useState(false)
  const [provenanceCard, setProvenanceCard] = React.useState<CDSCard | null>(null)
  const [provenanceData, setProvenanceData] = React.useState<CDSProvenanceResponse | null>(null)
  const [provenanceLoading, setProvenanceLoading] = React.useState(false)

  const patientId = candidate?.patient.patient_id
  React.useEffect(() => {
    if (!patientId) return
    setCdsLoading(true)
    fetchCDSCards(patientId)
      .then((res) => setCdsCards(res.cards))
      .catch(() => setCdsCards([]))
      .finally(() => setCdsLoading(false))
  }, [patientId])

  React.useEffect(() => {
    if (!provenanceCard || !patientId) return
    setProvenanceLoading(true)
    fetchCDSProvenance(patientId, provenanceCard.uuid)
      .then(setProvenanceData)
      .catch(() => setProvenanceData(null))
      .finally(() => setProvenanceLoading(false))
  }, [provenanceCard, patientId])

  if (!candidate) {
    return (
      <Card className={cn(presentation === "sheet" && "rounded-none border-0 shadow-none") }>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="h-4 w-4 text-primary" />
            Priority Intervention
          </CardTitle>
          <CardDescription>No clinically urgent escalations at the moment.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const { patient, liveReading, liveSignals, score } = candidate
  const headerBadges = getCandidateCoreBadges(candidate)
  const priorityLabel = getQueueUrgencyLabel(candidate)
  const primaryMeasureBadge = candidate.topGap?.hedis_measure ?? null

  const primaryCard = cdsCards[0] ?? null

  const vitalTriggers = cdsCards
    .filter((c) => c.extensions?.card_type === "alert")
    .flatMap((c) => c.extensions?.vital_triggers ?? [])
    .filter((t, i, arr) => arr.findIndex((o) => o.vital === t.vital) === i)

  const clinicalPressureSignals = vitalTriggers.length > 0
    ? vitalTriggers.slice(0, 3).map((t) => ({
        label: t.vital.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
        value: t.vital === "temperature" ? t.value.toFixed(1) : t.value.toFixed(0),
        unit: t.unit,
        status: `${capitalize(t.direction)} threshold`,
        detail: `Threshold: ${t.threshold}`,
        emphasis: true,
      }))
    : getPrioritySignals(candidate)

  const drivers = cdsCards.map((card) => ({
    card,
    label: card.summary,
    detail: card.detail,
    contextBadges: card.extensions?.context_factors ?? [],
    escalationReason: card.extensions?.escalation_reason,
  }))

  const steps = cdsCards.flatMap((card) =>
    card.suggestions.map((s) => ({ ...s, parentCard: card })),
  ).slice(0, 4)

  return (
    <Card
      className={cn(
        "border-border/60 bg-white shadow-sm",
        presentation === "sheet" && "rounded-none border-0 bg-transparent shadow-none",
      )}
    >
      <CardHeader className="gap-2 pb-4">
        <div
          className={cn(
            "flex flex-col gap-2 md:flex-row md:items-start md:justify-between",
            presentation === "sheet" && "pr-14 sm:pr-16",
          )}
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Priority Intervention</CardTitle>
              <Badge variant={getQueueUrgencyBadgeVariant(candidate)}>{priorityLabel}</Badge>
              {primaryMeasureBadge && (
                <Badge variant="secondary" className="bg-[#EDF4EF] text-[#234734]">
                  {primaryMeasureBadge}
                </Badge>
              )}
              {headerBadges.map((badge) => (
                <Badge key={badge} variant="secondary" className="border-transparent bg-muted/50 text-foreground">
                  {badge}
                </Badge>
              ))}
            </div>
            <div>
              <p className="text-xl font-semibold">{patient.demographics.name}</p>
              <p className="text-sm text-muted-foreground">
                {patient.demographics.age}y {patient.demographics.gender === "female" ? "female" : "male"} •{" "}
                {patient.hospital_name}
              </p>
            </div>
          </div>
          <Button asChild className={cn(presentation === "sheet" && "mr-2 sm:mr-4")}>
            <Link href={`/patients/${patient.patient_id}`} className="gap-1">
              Open patient chart
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        {cdsLoading ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-white p-3 shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading CDS guidance...</span>
          </div>
        ) : primaryCard ? (
          <button
            type="button"
            onClick={() => setProvenanceCard(primaryCard)}
            className="w-full rounded-lg border border-border/60 border-l-4 border-l-destructive bg-white p-3 text-left shadow-sm transition-colors hover:bg-accent/30"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Primary concern
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {primaryCard.summary}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {primaryCard.detail}
            </p>
          </button>
        ) : (
          <div className="rounded-lg border border-border/60 bg-white p-3 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Primary concern
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              No CDS cards available for this patient.
            </p>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="h-full rounded-lg border border-border/60 bg-white p-3 shadow-sm">
            <p className="text-sm font-medium">Clinical pressure</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {vitalTriggers.length > 0
                ? "Vital signs breaching personalized CDS thresholds."
                : "The key live measurements driving this review."}
            </p>
            <div className="mt-3 space-y-2">
              {clinicalPressureSignals.map((signal) => (
                <div
                  key={signal.label}
                  className="flex items-center justify-between gap-4 rounded-md border border-border/60 bg-white px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {signal.label}
                    </p>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className={cn("text-xl font-semibold", signal.emphasis && "text-destructive")}>
                        {signal.value}
                      </span>
                      <span className="text-xs text-muted-foreground">{signal.unit}</span>
                    </div>
                  </div>
                  <div className="min-w-[132px] text-right">
                    <p
                      className={cn(
                        "text-xs font-medium",
                        signal.emphasis ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {signal.status}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{signal.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="h-full rounded-lg border border-border/60 bg-white p-3 shadow-sm">
            <p className="text-sm font-medium">Escalation Drivers</p>
            {drivers.length > 0 ? (
              <div className="mt-3 space-y-2 text-sm text-foreground">
                {drivers.map((driver, index) => (
                  <button
                    key={driver.card.uuid}
                    type="button"
                    onClick={() => setProvenanceCard(driver.card)}
                    className="w-full rounded-md border border-border/60 bg-white px-3 py-2 text-left transition-colors hover:bg-accent/30"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-xs font-medium text-muted-foreground">{index + 1}.</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{driver.label}</p>
                        {driver.escalationReason && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{driver.escalationReason}</p>
                        )}
                        {driver.contextBadges.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {driver.contextBadges.map((badge) => (
                              <Badge
                                key={badge}
                                variant="secondary"
                                className="border border-[#CFF5DD] bg-[#F2FFF8] text-[#0F5A3C] text-[10px]"
                              >
                                {badge}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  {liveSignals.slice(0, 3).map((signal) => (
                    <Badge
                      key={signal}
                      variant="secondary"
                      className="border border-[#CFF5DD] bg-[#F2FFF8] text-[#0F5A3C]"
                    >
                      {signal}
                    </Badge>
                  ))}
                  {liveSignals.length === 0 && (
                    <Badge
                      variant="secondary"
                      className="border border-[#CFF5DD] bg-[#F2FFF8] text-[#0F5A3C]"
                    >
                      Context-aware monitoring remains active
                    </Badge>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-white p-3 shadow-sm">
          <p className="text-sm font-medium">Recommended next steps</p>
          <div className="mt-2.5 space-y-2">
            {steps.length > 0
              ? steps.slice(0, 2).map((step, index) => (
                  <button
                    key={step.uuid}
                    type="button"
                    onClick={() => setProvenanceCard(step.parentCard)}
                    className="flex w-full gap-3 rounded-md border border-border/60 bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-accent/30"
                  >
                    <span className="text-xs font-medium text-muted-foreground">{index + 1}.</span>
                    <span>{step.label}</span>
                  </button>
                ))
              : (
                <div className="flex gap-3 rounded-md border border-border/60 bg-white px-3 py-2 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">1.</span>
                  <span>Open the patient chart and review recent trajectory</span>
                </div>
              )}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {candidate.recentAlertCount} recent escalation{candidate.recentAlertCount === 1 ? "" : "s"}
            </span>
            <span>{formatRelativeTime(liveReading.timestamp)}</span>
          </div>
        </div>
      </CardContent>

      <Dialog open={provenanceCard !== null} onOpenChange={(open) => { if (!open) setProvenanceCard(null) }}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {provenanceCard?.summary}
              {provenanceCard && (
                <Badge
                  variant={
                    provenanceCard.indicator === "critical"
                      ? "destructive"
                      : provenanceCard.indicator === "warning"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {provenanceCard.indicator}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2">
              <span>CDS Hooks patient-view</span>
              <span className="text-muted-foreground">•</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                POST /hooks/cds-services/patient-view
              </code>
            </DialogDescription>
          </DialogHeader>

          {provenanceLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : provenanceData ? (
            <Tabs defaultValue="card">
              <TabsList className="w-full">
                <TabsTrigger value="card" className="flex-1">CDS Card</TabsTrigger>
                <TabsTrigger value="rule" className="flex-1">CDS Rule</TabsTrigger>
                <TabsTrigger value="source" className="flex-1">Source Document</TabsTrigger>
              </TabsList>
              <TabsContent value="card">
                <JsonTreeView value={provenanceData.card} collapsed={2} />
              </TabsContent>
              <TabsContent value="rule">
                {provenanceData.source_rule ? (
                  <JsonTreeView value={provenanceData.source_rule} collapsed={2} />
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">
                    No CDS rule is directly associated with this card.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="source">
                {provenanceData.alert_document ? (
                  <JsonTreeView value={provenanceData.alert_document} collapsed={2} />
                ) : provenanceData.care_gap_document ? (
                  <JsonTreeView value={provenanceData.care_gap_document} collapsed={2} />
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">
                    No source document available.
                  </p>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              Unable to load provenance data.
            </p>
          )}

          <DialogFooter className="flex-col items-start gap-1 sm:flex-col">
            <p className="text-xs text-muted-foreground">
              Data source: {provenanceData?.data_source ?? "MongoDB patient_360 + cds_rules + alerts collections"}
            </p>
            {provenanceData?.generated_at && (
              <p className="text-xs text-muted-foreground">
                Generated: {new Date(provenanceData.generated_at).toLocaleString()}
              </p>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ReviewQueueCard({
  candidates,
  selectedPatientId,
  summary,
  onOpenPatient,
}: {
  candidates: EscalationCandidate[]
  selectedPatientId: string | null
  summary: QueueSummary
  onOpenPatient: (patientId: string) => void
}) {
  const careGapsHandoff = getCareGapsHandoff(candidates)

  const priorityBreakdown = (() => {
    let immediate = 0
    let high = 0
    let watch = 0
    candidates.forEach((c) => {
      const label = getQueueUrgencyLabel(c)
      if (label === "Immediate review") immediate++
      else if (label === "High priority") high++
      else watch++
    })
    const total = candidates.length || 1
    return {
      immediate,
      high,
      watch,
      immediatePct: Math.round((immediate / total) * 100),
      highPct: Math.round((high / total) * 100),
      watchPct: Math.round((watch / total) * 100),
    }
  })()

  const measureDistribution = (() => {
    const counts = new Map<string, number>()
    candidates.forEach((c) => {
      const measure = c.topGap?.hedis_measure
      if (measure) counts.set(measure, (counts.get(measure) ?? 0) + 1)
    })
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  })()

  const maxMeasureCount = measureDistribution[0]?.[1] ?? 1

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="gap-1.5 border-border/60 py-3 shadow-sm">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Priority Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4">
            {([
              { label: "Immediate review", count: priorityBreakdown.immediate, pct: priorityBreakdown.immediatePct, dotClass: "bg-red-500" },
              { label: "High priority", count: priorityBreakdown.high, pct: priorityBreakdown.highPct, dotClass: "bg-amber-500" },
              { label: "Priority watch", count: priorityBreakdown.watch, pct: priorityBreakdown.watchPct, dotClass: "bg-blue-500" },
            ] as const).map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", row.dotClass)} />
                  <span className="text-sm text-foreground">{row.label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold tabular-nums">{row.count}</span>
                  <span className="rounded-full border px-1.5 py-0 text-[10px] tabular-nums text-muted-foreground">
                    {row.pct}%
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="gap-1.5 border-border/60 py-3 shadow-sm">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
              Queue by Measure
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4">
            {measureDistribution.length > 0 ? (
              measureDistribution.map(([measure, count], idx) => {
                const barColors = ["bg-indigo-500", "bg-amber-500", "bg-sky-500", "bg-teal-500", "bg-slate-400"]
                return (
                  <div key={measure} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{getCareGapMeasureDashboardLabel(measure)}</span>
                      <span className="tabular-nums text-muted-foreground">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full transition-all", barColors[idx % barColors.length])}
                        style={{ width: `${(count / maxMeasureCount) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-sm text-muted-foreground">No measures in queue.</p>
            )}
          </CardContent>
        </Card>

        <Card className="gap-1.5 border-border/60 py-3 shadow-sm">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              Escalated Cases
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="flex items-baseline gap-2">
              <TrendingUp className="h-4 w-4 self-center text-destructive" />
              <p className="text-2xl font-semibold tabular-nums text-destructive">{summary.escalatedCount}</p>
              <p className="text-xs text-muted-foreground">Patients at immediate or high-priority threshold</p>
            </div>
            <div className="mt-2 border-t border-border/60 pt-2">
              <div className="flex items-center gap-1.5">
                <ClipboardList className="h-3 w-3 text-[#0F5F3D]" />
                <span className="text-xs font-medium text-foreground">Measures Under Pressure</span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <p className="text-xl font-semibold tabular-nums text-[#163828]">{summary.measureCount}</p>
                <p className="text-xs text-muted-foreground">Distinct HEDIS measures in queue</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-[#D6E8DD] bg-[#F8FCFA] px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-[#163828]">
            <Sparkles className="h-3.5 w-3.5 text-[#0F5F3D]" />
            Next recommended review: <span className="text-[#0F5F3D]">{summary.nextLabel}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground line-clamp-1">{summary.nextReason}</p>
        </div>
        <Badge className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#0F5F3D] px-3 py-1 text-white hover:bg-[#0F5F3D]">
          <Users className="h-3 w-3" />
          {summary.queueCount} cases waiting
        </Badge>
      </div>

      <Card className="gap-0 overflow-hidden border-border/60 py-0 shadow-sm">
        <div className="flex items-center gap-4 border-b border-border/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
          <div className="w-9 shrink-0" />
          <div className="flex min-w-0 flex-1">
            <span className="flex items-center gap-1"><Users className="h-3 w-3" />Patient</span>
            <span className="ml-auto">Conditions</span>
          </div>
          <span className="hidden w-[152px] shrink-0 text-center sm:block">Counter</span>
          <div className="w-4 shrink-0" />
        </div>
        {candidates.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-[#163828]">No intervention cases are waiting.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The queue will repopulate when new context-elevated gaps or alerts surface.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {candidates.map((candidate) => {
              const isSelected = selectedPatientId === candidate.patient.patient_id
              const urgencyLabel = getQueueUrgencyLabel(candidate)

              return (
                <button
                  key={candidate.patient.patient_id}
                  type="button"
                  onClick={() => onOpenPatient(candidate.patient.patient_id)}
                  className={cn(
                    "group flex w-full items-start gap-4 px-4 py-3 text-left transition-colors",
                    isSelected ? "bg-[#F3FBF6]" : "hover:bg-muted/20",
                  )}
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                    {candidate.patient.demographics.given?.[0]}
                    {candidate.patient.demographics.family?.[0]}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {candidate.patient.demographics.name}
                      </p>
                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <Badge
                          variant={getQueueUrgencyBadgeVariant(candidate)}
                          className={cn(
                            "text-[10px]",
                            getQueueUrgencyBadgeVariant(candidate) === "destructive" &&
                              "border-[#F5D0D0] bg-[#FFF0F0] text-destructive",
                          )}
                        >
                          {urgencyLabel}
                        </Badge>
                        {candidate.topGap && (
                          <Badge variant="secondary" className="bg-[#EDF4EF] text-[10px] text-[#234734]">
                            {candidate.topGap.hedis_measure}
                          </Badge>
                        )}
                        {candidate.primaryAlert && (
                          <Badge
                            variant="outline"
                            className="border-[#F5D0D0] bg-[#FFF6F6] text-[10px] text-destructive"
                          >
                            {capitalize(candidate.primaryAlert.severity)} alert
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {candidate.patient.hospital_name} • {candidate.patient.demographics.age}y{" "}
                      {candidate.patient.demographics.gender === "female" ? "F" : "M"}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground/80 line-clamp-1">
                      {getCandidateReasonLine(candidate)}
                    </p>
                  </div>

                  <div className="hidden shrink-0 items-start gap-2 sm:flex">
                    <div className="w-[72px] rounded-lg border border-border/60 bg-muted/30 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <Layers className="h-2.5 w-2.5" />
                        Gaps
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-foreground">{candidate.overdueGapCount}</p>
                    </div>
                    <div className="w-[72px] rounded-lg border border-border/60 bg-muted/30 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <Bell className="h-2.5 w-2.5" />
                        Alerts
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-foreground">{candidate.recentAlertCount}</p>
                    </div>
                  </div>

                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              )
            })}
          </div>
        )}

        <div className="border-t border-border/60 bg-muted/20 px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ClipboardList className="h-4 w-4 text-primary" />
              <span className="whitespace-nowrap">Continue in Care Gaps</span>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={careGapsHandoff.href} className="gap-1">
                Manage HEDIS gap operations
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  variant = "default",
}: {
  title: string
  value: number
  description: string
  icon: React.ComponentType<{ className?: string }>
  trend: CardTrend | null
  variant?: "default" | "critical" | "warning"
}) {
  const isPlainTrend = trend?.format === "plain"

  return (
    <Card
      className={cn(
        variant === "critical" && "border-destructive/50 bg-destructive/5",
        variant === "warning" && "border-warning/50 bg-warning/5",
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon
          className={cn(
            "h-4 w-4",
            variant === "default" && "text-muted-foreground",
            variant === "critical" && "text-destructive",
            variant === "warning" && "text-warning",
          )}
        />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-3xl font-bold",
              variant === "critical" && "text-destructive",
              variant === "warning" && "text-warning",
            )}
          >
            {value}
          </span>
          {trend && trend.value > 0 && !isPlainTrend && (
            <span
              className={cn(
                "flex items-center text-xs",
                trend.direction === "up" ? "text-destructive" : "text-emerald-600",
              )}
            >
              {trend.direction === "up" ? (
                <TrendingUp className="mr-0.5 h-3 w-3" />
              ) : (
                <TrendingDown className="mr-0.5 h-3 w-3" />
              )}
              +{trend.value}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        {trend && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {isPlainTrend ? trend.value : trend.value > 0 ? `+${trend.value}` : "0"} {trend.label}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function rankEscalationPatients(
  patients: Patient360[],
  liveReadings: Map<string, LiveReading>,
  recentAlerts: AlertNotification[],
): EscalationCandidate[] {
  return patients
    .map((patient) => buildEscalationCandidate(patient, liveReadings.get(patient.patient_id), recentAlerts))
    .filter((candidate): candidate is EscalationCandidate => candidate !== null)
    .sort((left, right) => {
      const scoreDiff = right.score - left.score
      if (scoreDiff !== 0) return scoreDiff

      const overdueDiff = (right.topGap?.days_overdue ?? 0) - (left.topGap?.days_overdue ?? 0)
      if (overdueDiff !== 0) return overdueDiff

      return right.recentAlertCount - left.recentAlertCount
    })
}

function buildEscalationCandidate(
  patient: Patient360,
  liveReading: LiveReading | undefined,
  recentAlerts: AlertNotification[],
): EscalationCandidate | null {
  const topGap = getTopRelevantGap(patient)
  if (!topGap) {
    return null
  }

  const openGaps = getOpenCareGaps(patient)
  const criticalAlerts = patient.active_alerts.filter((alert) => alert.severity === "critical")
  const highAlerts = patient.active_alerts.filter((alert) => alert.severity === "high")
  const primaryAlert = criticalAlerts[0] ?? highAlerts[0] ?? patient.active_alerts[0] ?? null
  const thresholdBreaches = getThresholdBreaches(patient, liveReading)
  const liveSignals = getVitalsRiskSignals(patient, liveReading)
  const overdueGapCount = openGaps.filter((gap) => gap.days_overdue > 0).length
  const sessionAlerts = recentAlerts.filter((alert) => alert.patient_id === patient.patient_id)
  const recentSessionAlerts = sessionAlerts.filter((alert) => isWithinWindow(alert.timestamp, ALERT_WINDOW_MS))
  const measurePressureScore = getMeasurePressureScore(topGap, openGaps.length)
  const livePressureScore = getLivePressureScore(thresholdBreaches, liveSignals, liveReading?.event ?? null)
  const contextPressureScore = getContextPressureScore(patient, topGap.hedis_measure)
  const alertPressureScore = getAlertPressureScore(patient, recentSessionAlerts.length)
  const score =
    measurePressureScore +
    livePressureScore +
    contextPressureScore +
    alertPressureScore

  if (score <= 0) {
    return null
  }

  return {
    patient,
    score,
    topGap,
    primaryAlert,
    liveReading: getCurrentReading(patient, liveReading),
    liveSignals,
    thresholdBreaches,
    overdueGapCount,
    recentAlertCount: recentSessionAlerts.length,
    eventLabel: liveReading?.event ? capitalize(liveReading.event) : null,
    measurePressureScore,
    livePressureScore,
    contextPressureScore,
    alertPressureScore,
  }
}

function getCurrentReading(patient: Patient360, liveReading?: LiveReading): CurrentReading {
  if (liveReading) {
    return {
      timestamp: liveReading.timestamp,
      heart_rate: liveReading.heart_rate,
      respiratory_rate: liveReading.respiratory_rate,
      temperature: liveReading.temperature,
      spo2: liveReading.spo2,
      activity_level: liveReading.activity_level,
      event: liveReading.event,
    }
  }

  return {
    ...patient.vitals_summary.latest,
    event: null,
  }
}

function getThresholdBreaches(patient: Patient360, liveReading?: LiveReading): ThresholdBreach[] {
  const reading = getCurrentReading(patient, liveReading)
  const breaches: ThresholdBreach[] = []

  ;(Object.keys(VITAL_CONFIG) as VitalKey[]).forEach((vital) => {
    const threshold = patient.personalized_thresholds[vital]
    const currentValue = reading[vital]
    if (threshold.high !== null && currentValue > threshold.high) {
      breaches.push({
        vital,
        direction: "above",
        threshold: threshold.high,
        current: currentValue,
      })
    } else if (threshold.low !== null && currentValue < threshold.low) {
      breaches.push({
        vital,
        direction: "below",
        threshold: threshold.low,
        current: currentValue,
      })
    }
  })

  return breaches
}

function getVitalsRiskSignals(patient: Patient360, liveReading?: LiveReading): string[] {
  const reading = getCurrentReading(patient, liveReading)
  const thresholdBreaches = getThresholdBreaches(patient, liveReading)
  const trend = patient.vitals_summary.trend_24h
  const signals = new Set<string>()

  thresholdBreaches.forEach((breach) => {
    signals.add(`${VITAL_CONFIG[breach.vital].label} ${breach.direction} threshold`)
  })

  if (trend.heart_rate === "increasing") signals.add("Heart rate trending up")
  if (trend.respiratory_rate === "increasing") signals.add("Respiratory rate trending up")
  if (trend.spo2 === "decreasing") signals.add("SpO2 trending down")
  if (trend.activity_level === "decreasing") signals.add("Activity trending down")
  if (reading.event === "hypoglycemia") signals.add("Hypoglycemia pattern detected")
  if (reading.event === "sepsis") signals.add("Sepsis pattern detected")

  return Array.from(signals)
}

function hasLivePressure(patient: Patient360, liveReading?: LiveReading) {
  return getThresholdBreaches(patient, liveReading).length > 0 || getVitalsRiskSignals(patient, liveReading).length >= 2
}

function getMeasurePressureScore(topGap: CareGap, openGapCount: number) {
  const priorityWeight: Record<CareGap["priority"], number> = {
    critical: 95,
    high: 72,
    medium: 44,
    low: 20,
  }
  const overdueWeight = Math.min(topGap.days_overdue, 120)
  const additionalGapWeight = Math.min(Math.max(openGapCount - 1, 0) * 10, 30)

  return 95 + (priorityWeight[topGap.priority] ?? 20) + Math.round(overdueWeight * 0.7) + getMeasureStrategicWeight(topGap.hedis_measure) + additionalGapWeight
}

function getMeasureStrategicWeight(measure: string) {
  const strategicWeight: Record<string, number> = {
    "CDC-HBA": 30,
    KED: 28,
    CBP: 24,
    SPD: 18,
    EED: 16,
  }

  return strategicWeight[measure] ?? 12
}

function getLivePressureScore(
  thresholdBreaches: ThresholdBreach[],
  liveSignals: string[],
  event: LiveReading["event"] | null,
) {
  const nonBreachSignalCount = Math.max(liveSignals.length - thresholdBreaches.length, 0)
  const eventBoost =
    event === "sepsis" ? 42 : event === "hypoglycemia" ? 36 : 0

  return thresholdBreaches.length * 22 + nonBreachSignalCount * 10 + eventBoost
}

function getContextPressureScore(patient: Patient360, measure: string) {
  let score = 0

  if (patient.flags.has_ckd) score += 16
  if (patient.flags.has_insulin) score += 14
  if (patient.flags.has_beta_blocker) score += 8
  if (patient.conditions.some((condition) => condition.display.toLowerCase().includes("hypertension"))) {
    score += 8
  }

  if (measure === "KED" && patient.flags.has_ckd) score += 20
  if (measure === "CDC-HBA" && patient.flags.has_insulin) score += 20
  if (measure === "CBP" && patient.conditions.some((condition) => condition.display.toLowerCase().includes("hypertension"))) {
    score += 18
  }
  if (measure === "SPD") score += 12
  if (measure === "EED") score += 10

  return score
}

function getAlertPressureScore(patient: Patient360, recentAlertCount: number) {
  const criticalCount = patient.active_alerts.filter((alert) => alert.severity === "critical").length
  const highCount = patient.active_alerts.filter((alert) => alert.severity === "high").length
  const moderateCount = patient.active_alerts.filter(
    (alert) => alert.severity === "moderate" || alert.severity === "medium",
  ).length

  return criticalCount * 26 + highCount * 16 + moderateCount * 8 + recentAlertCount * 12
}

function buildClinicalSummaryMetrics(
  patients: Patient360[],
  liveReadings: Map<string, LiveReading>,
  recentAlerts: AlertNotification[],
  rankedEscalations: EscalationCandidate[],
): ClinicalSummaryMetrics {
  const patientsWithRecentAlerts = new Set(
    recentAlerts
      .filter((alert) => isWithinWindow(alert.timestamp, ALERT_WINDOW_MS))
      .map((alert) => alert.patient_id),
  )
  const rankedPatientIds = new Set(rankedEscalations.map((candidate) => candidate.patient.patient_id))
  const interventionPatients = new Set<string>()
  let contextElevatedGapCount = 0
  const pressuredMeasures = new Map<string, number>()

  patients.forEach((patient) => {
    const liveReading = liveReadings.get(patient.patient_id)
    const openGaps = getOpenCareGaps(patient)
    if (openGaps.length === 0) return

    const hasActionableContext =
      hasSeriousActiveAlert(patient) ||
      patientsWithRecentAlerts.has(patient.patient_id) ||
      Boolean(liveReading && hasLivePressure(patient, liveReading)) ||
      rankedPatientIds.has(patient.patient_id)

    if (!hasActionableContext) return

    interventionPatients.add(patient.patient_id)
    contextElevatedGapCount += openGaps.length

    openGaps.forEach((gap) => {
      pressuredMeasures.set(gap.hedis_measure, (pressuredMeasures.get(gap.hedis_measure) ?? 0) + 1)
    })
  })

  const pressuredMeasureLabels = Array.from(pressuredMeasures.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([measure]) => getCareGapMeasureDashboardLabel(measure))

  return {
    contextElevatedGapCount,
    interventionPatientCount: interventionPatients.size,
    pressuredMeasureCount: pressuredMeasures.size,
    pressuredMeasureLabels,
  }
}

function hasSeriousActiveAlert(patient: Patient360) {
  return patient.active_alerts.some((alert) => alert.severity === "critical" || alert.severity === "high")
}

function getPatientContextBadges(patient: Patient360) {
  const badges = [
    patient.flags.has_insulin ? "Insulin" : null,
    patient.flags.has_ckd ? "CKD" : null,
    patient.flags.has_beta_blocker ? "Beta-blocker" : null,
    patient.conditions.find((condition) => condition.display.toLowerCase().includes("hypertension")) ? "Hypertension" : null,
  ].filter((value): value is string => Boolean(value))

  return badges
}

function isImmediateReviewCandidate(candidate: EscalationCandidate) {
  return hasSeriousActiveAlert(candidate.patient) || candidate.score >= 180
}

function getCandidateReasonLine(candidate: EscalationCandidate) {
  const topGap = candidate.topGap
  const measureLabel = topGap ? getCareGapMeasureDashboardLabel(topGap.hedis_measure) : "This case"
  const contextAmplifier = getCandidateContextAmplifier(candidate)
  const clinicalAmplifier = getCandidateClinicalAmplifier(candidate)

  const normalizedContext = normalizeQueueReasonFragment(contextAmplifier)
  const normalizedClinical = normalizeQueueReasonFragment(clinicalAmplifier)

  if (topGap && normalizedContext && normalizedClinical) {
    return `${measureLabel} is more urgent because ${normalizedContext} is paired with ${normalizedClinical}.`
  }

  if (topGap && normalizedClinical) {
    return `${measureLabel} is rising in priority because ${normalizedClinical}.`
  }

  if (topGap && normalizedContext) {
    return `${measureLabel} is higher priority in the setting of ${normalizedContext}.`
  }

  if (topGap) {
    return `${measureLabel} is the primary open gap for review.`
  }

  if (normalizedClinical) {
    return `This case needs review because ${normalizedClinical}.`
  }

  return "This patient has active intervention pressure requiring review."
}

function getQueueSupportBadges(candidate: EscalationCandidate) {
  const badges = [...getCandidateCoreBadges(candidate)]

  if (candidate.recentAlertCount > 0) {
    badges.push(
      `${candidate.recentAlertCount} recent escalation${candidate.recentAlertCount === 1 ? "" : "s"}`,
    )
  }

  if (candidate.overdueGapCount > 0) {
    badges.push(`${candidate.overdueGapCount} open care gap${candidate.overdueGapCount === 1 ? "" : "s"}`)
  }

  return badges.slice(0, 3)
}

function getCandidateCoreBadges(candidate: EscalationCandidate) {
  const badges: string[] = []
  badges.push(...getPatientContextBadges(candidate.patient).slice(0, 2))

  return badges.slice(0, 3)
}

function getQueueUrgencyLabel(candidate: EscalationCandidate) {
  if (candidate.primaryAlert?.severity === "critical" || candidate.score >= 260) {
    return "Immediate review"
  }

  if (candidate.score >= 180) {
    return "High priority"
  }

  return "Priority watch"
}

function getQueueUrgencyBadgeVariant(candidate: EscalationCandidate): "destructive" | "secondary" | "outline" {
  if (candidate.primaryAlert?.severity === "critical" || candidate.score >= 260) {
    return "destructive"
  }

  if (candidate.score >= 180) {
    return "secondary"
  }

  return "outline"
}


function getCareGapsHandoff(candidates: EscalationCandidate[]) {
  const topMeasures = Array.from(
    new Set(
      candidates
        .map((candidate) => candidate.topGap?.hedis_measure)
        .filter((measure): measure is string => Boolean(measure)),
    ),
  ).slice(0, 3)
  const params = new URLSearchParams({ source: "dashboard" })

  if (topMeasures.length > 0) {
    params.set("measures", topMeasures.join(","))
  }

  return {
    href: `/care-gaps?${params.toString()}`,
  }
}

function getOpenCareGaps(patient: Patient360) {
  return patient.care_gaps.filter((gap) => gap.status === "open")
}

function getTopRelevantGap(patient: Patient360) {
  const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

  return getOpenCareGaps(patient).sort((left, right) => {
    const overdueDiff = right.days_overdue - left.days_overdue
    if (overdueDiff !== 0) return overdueDiff
    return (priorityRank[left.priority] ?? 4) - (priorityRank[right.priority] ?? 4)
  })[0] ?? null
}

function getCandidateContextAmplifier(candidate: EscalationCandidate) {
  const { patient, topGap } = candidate
  const measure = topGap?.hedis_measure

  if (measure === "KED" && patient.flags.has_ckd) return "CKD context"
  if (measure === "CDC-HBA" && patient.flags.has_insulin) return "Insulin-treated diabetes"
  if (
    measure === "CBP" &&
    patient.conditions.some((condition) => condition.display.toLowerCase().includes("hypertension"))
  ) {
    return "Hypertension context"
  }
  if (measure === "SPD") return "Cardiovascular prevention risk"
  if (measure === "EED") return "Diabetes screening risk"

  return getPatientContextBadges(patient)[0] ?? "Quality risk context"
}

function getCandidateClinicalAmplifier(candidate: EscalationCandidate) {
  const firstBreach = candidate.thresholdBreaches[0]

  if (candidate.eventLabel) {
    return `${candidate.eventLabel} pattern detected`
  }

  if (firstBreach) {
    return `${VITAL_CONFIG[firstBreach.vital].label} ${firstBreach.direction} threshold`
  }

  if (candidate.liveSignals.length > 0) {
    return candidate.liveSignals[0]
  }

  if (candidate.recentAlertCount > 0) {
    return `${candidate.recentAlertCount} recent escalation${candidate.recentAlertCount === 1 ? "" : "s"}`
  }

  return "Open gap burden remains unresolved"
}

function normalizeQueueReasonFragment(value: string) {
  const normalized = lowercaseFirst(value.trim().replace(/\.$/, ""))

  if (!normalized) return ""

  const replacements: Record<string, string> = {
    "ckd context": "CKD risk",
    "hypertension context": "hypertension risk",
    "quality risk context": "quality risk context",
    "cardiovascular prevention risk": "cardiovascular prevention risk",
    "diabetes screening risk": "diabetes screening risk",
    "heart rate above threshold": "heart rate above threshold",
    "heart rate below threshold": "heart rate below threshold",
    "hr above threshold": "heart rate above threshold",
    "hr below threshold": "heart rate below threshold",
    "respiratory rate above threshold": "respiratory rate above threshold",
    "respiratory rate below threshold": "respiratory rate below threshold",
    "spo2 below threshold": "SpO2 below threshold",
    "spo2 above threshold": "SpO2 above threshold",
    "temperature above threshold": "temperature above threshold",
    "temperature below threshold": "temperature below threshold",
    "hypoglycemia pattern detected": "a hypoglycemia pattern is surfacing",
    "sepsis pattern detected": "a sepsis pattern is surfacing",
    "open gap burden remains unresolved": "open gap burden remains unresolved",
  }

  return replacements[normalized] ?? normalized
}

function getPrioritySignals(candidate: EscalationCandidate) {
  const orderedVitals: VitalKey[] = []

  candidate.thresholdBreaches.forEach((breach) => {
    if (!orderedVitals.includes(breach.vital)) {
      orderedVitals.push(breach.vital)
    }
  })

  ;(["spo2", "heart_rate", "respiratory_rate", "temperature"] as VitalKey[]).forEach((vital) => {
    if (!orderedVitals.includes(vital)) {
      orderedVitals.push(vital)
    }
  })

  return orderedVitals.slice(0, 3).map((vital) => {
    const breach = candidate.thresholdBreaches.find((item) => item.vital === vital)
    const threshold = candidate.patient.personalized_thresholds[vital]
    const trend = candidate.patient.vitals_summary.trend_24h[vital]

    return {
      label: VITAL_CONFIG[vital].label,
      value: formatVitalValue(vital, candidate.liveReading[vital]),
      unit: VITAL_CONFIG[vital].unit,
      status: breach ? `${capitalize(breach.direction)} threshold` : formatTrendLabel(trend),
      detail: `Expected ${formatThresholdRange(threshold.low, threshold.high)}`,
      emphasis: Boolean(breach),
    }
  })
}

function getPriorityReviewLabel(score: number) {
  if (score >= 380) return "Escalated"
  if (score >= 260) return "Escalated"
  if (score >= 180) return "High priority"
  return "Priority watch"
}

function lowercaseFirst(value: string) {
  return value.length > 0 ? value.charAt(0).toLowerCase() + value.slice(1) : value
}

function formatVitalValue(vital: VitalKey, value: number) {
  return vital === "temperature" ? value.toFixed(1) : value.toFixed(0)
}

function formatThresholdRange(low: number | null, high: number | null) {
  if (low === null && high === null) return "not set"
  if (low === null) return `<= ${high}`
  if (high === null) return `>= ${low}`
  return `${low}-${high}`
}

function formatTrendLabel(trend: Patient360["vitals_summary"]["trend_24h"][VitalKey]) {
  if (trend === "increasing") return "Trending up"
  if (trend === "decreasing") return "Trending down"
  return "Stable"
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function isWithinWindow(isoString: string, windowMs: number) {
  return Date.now() - new Date(isoString).getTime() <= windowMs
}

function capitalize(value: string) {
  if (!value) return value
  return `${value[0].toUpperCase()}${value.slice(1)}`
}

