"use client"

import * as React from "react"
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  HeartPulse,
  Loader2,
  Radio,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useDemo } from "@/lib/demo-context"
import { fetchAllPatients } from "@/lib/api"
import { useSimulation, type AlertNotification, type LiveReading } from "@/lib/simulation-context"
import {
  getCareGapMeasureMeta,
  getCareGapMeasureActionLabel,
  getCareGapMeasureDashboardLabel,
} from "@/lib/care-gap-measures"
import { type Alert as PatientAlert, type CareGap, type Patient360 } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

const LIVE_WINDOW_MS = 60 * 1000
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

type LiveMetric = {
  label: string
  value: string
  detail: string
  variant?: "default" | "critical" | "warning"
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
  suggestedActions: string[]
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
  const liveMetrics = React.useMemo(
    () =>
      buildLiveMetrics({
        isRunning,
        clinicalSummary,
        liveReadings: liveReadingsList,
        recentAlerts,
      }),
    [isRunning, clinicalSummary, liveReadingsList, recentAlerts],
  )
  const [selectedPriorityPatientId, setSelectedPriorityPatientId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (rankedEscalations.length === 0) {
      setSelectedPriorityPatientId(null)
      return
    }

    const selectedCandidate = selectedPriorityPatientId
      ? rankedEscalations.find((candidate) => candidate.patient.patient_id === selectedPriorityPatientId) ?? null
      : null

    if (!selectedCandidate) {
      setSelectedPriorityPatientId(rankedEscalations[0].patient.patient_id)
    }
  }, [rankedEscalations, selectedPriorityPatientId])

  const topEscalation = React.useMemo(
    () =>
      selectedPriorityPatientId
        ? rankedEscalations.find((candidate) => candidate.patient.patient_id === selectedPriorityPatientId) ?? null
        : rankedEscalations[0] ?? null,
    [rankedEscalations, selectedPriorityPatientId],
  )

  const reviewQueue = React.useMemo(() => {
    if (!topEscalation) return []

    return rankedEscalations.filter(
      (candidate) => candidate.patient.patient_id !== topEscalation.patient.patient_id,
    )
  }, [rankedEscalations, topEscalation])

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

      <LiveCommandBar isRunning={isRunning} metrics={liveMetrics} />

      <div className="grid items-start gap-5 xl:grid-cols-[1.35fr_0.95fr]">
        <TopEscalationCard candidate={topEscalation} />
        <ReviewQueueCard
          candidates={reviewQueue}
          onSelectPatient={(patientId) => setSelectedPriorityPatientId(patientId)}
        />
      </div>
    </div>
  )
}

function LiveCommandBar({
  isRunning,
  metrics,
}: {
  isRunning: boolean
  metrics: LiveMetric[]
}) {
  return (
    <Card className="border-border/60 bg-white shadow-sm">
      <CardContent className="px-4 py-1">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-[208px] items-center gap-3">
            <div className="flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-medium">Intervention Status</span>
            </div>
            <Badge
              variant={isRunning ? "default" : "secondary"}
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                isRunning && "bg-[#00ED64] text-black hover:bg-[#00ED64]",
              )}
            >
              {isRunning ? "Live" : "Standing by"}
            </Badge>
          </div>

          <div className="grid gap-2 md:grid-cols-3 xl:flex-1 xl:grid-cols-[1.35fr_1fr_1fr] xl:gap-0">
            {metrics.map((metric, index) => (
              <div
                key={metric.label}
                className={cn(
                  "flex min-h-[66px] flex-col justify-between rounded-md border border-border/50 px-3 py-2 xl:min-h-[62px] xl:rounded-none xl:border-y-0 xl:border-r-0 xl:border-l-0",
                  index === 0 &&
                    "border-[#CFF5DD] bg-[#F6FFFA] xl:border-l xl:border-[#CFF5DD] xl:bg-[#F6FFFA]",
                  index > 0 && "xl:border-l xl:border-border/60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {metric.label}
                  </p>
                  <p
                    className={cn(
                      index === 0 ? "text-3xl font-semibold leading-none" : "text-2xl font-semibold leading-none",
                      metric.variant === "critical" && "text-destructive",
                      metric.variant === "warning" && "text-warning",
                    )}
                  >
                    {metric.value}
                  </p>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {metric.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function TopEscalationCard({
  candidate,
}: {
  candidate: EscalationCandidate | null
}) {
  if (!candidate) {
    return (
      <Card>
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

  const { patient, liveReading, thresholdBreaches, liveSignals, score } = candidate
  const topContext = getPatientContextSummary(patient)
  const headerBadges = getCandidateCoreBadges(candidate)
  const priorityLabel = getPriorityReviewLabel(score)
  const whySurfaced = getWhySurfacedReasons(candidate)
  const currentSignals = getPrioritySignals(candidate)
  const primaryConcern = getPrimaryConcern(candidate)
  const interventionActions = deriveInterventionActions(candidate)

  return (
    <Card className="border-border/60 bg-white shadow-sm">
      <CardHeader className="gap-2 pb-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Priority Intervention</CardTitle>
              <Badge variant="destructive">{priorityLabel}</Badge>
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
          <Button asChild>
            <Link href={`/patients/${patient.patient_id}`} className="gap-1">
              Open patient chart
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
        <div className="rounded-lg border border-border/60 border-l-4 border-l-destructive bg-white p-3 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Primary concern
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {primaryConcern.title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {primaryConcern.summary}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="h-full rounded-lg border border-border/60 bg-white p-3 shadow-sm">
            <p className="text-sm font-medium">Clinical pressure</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The key live measurements driving this review.
            </p>
            <div className="mt-3 space-y-2">
              {currentSignals.map((signal) => (
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
            <div className="mt-3 space-y-2 text-sm text-foreground">
              {whySurfaced.map((reason, index) => (
                <div key={reason} className="rounded-md border border-border/60 bg-white px-3 py-2">
                  <span className="mr-2 text-xs font-medium text-muted-foreground">{index + 1}.</span>
                  {reason}
                </div>
              ))}
              <div className="rounded-md border border-border/60 bg-white px-3 py-2">
                <span className="font-medium text-foreground">Context:</span>{" "}
                <span className="text-foreground">{topContext}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-white p-3 shadow-sm">
          <p className="text-sm font-medium">Recommended next steps</p>
          <div className="mt-2.5 space-y-2">
            {interventionActions.slice(0, 2).map((action, index) => (
              <div
                key={action}
                className="flex gap-3 rounded-md border border-border/60 bg-white px-3 py-2 text-sm"
              >
                <span className="text-xs font-medium text-muted-foreground">{index + 1}.</span>
                <span>{action}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {candidate.recentAlertCount} recent escalation{candidate.recentAlertCount === 1 ? "" : "s"}
            </span>
            <span>{formatRelativeTime(liveReading.timestamp)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ReviewQueueCard({
  candidates,
  onSelectPatient,
}: {
  candidates: EscalationCandidate[]
  onSelectPatient: (patientId: string) => void
}) {
  const careGapsHandoff = getCareGapsHandoff(candidates)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4 text-primary" />
          Intervention Queue
        </CardTitle>
        <CardDescription className="text-xs leading-5">
          The next care-gap interventions to work after the current case.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {candidates.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No additional cases are waiting in the queue.</p>
        ) : (
          candidates.slice(0, 3).map((candidate, index) => (
            <button
              key={candidate.patient.patient_id}
              type="button"
              onClick={() => onSelectPatient(candidate.patient.patient_id)}
              className="w-full rounded-lg border border-border/70 bg-background/80 p-3 text-left transition-colors hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Next #{index + 1}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="font-medium">{candidate.patient.demographics.name}</p>
                    <Badge variant={candidate.score >= 260 ? "destructive" : "secondary"}>
                      {getPriorityReviewLabel(candidate.score)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {candidate.patient.hospital_name} • {candidate.patient.demographics.age}y{" "}
                    {candidate.patient.demographics.gender === "female" ? "female" : "male"}
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {getCandidateReasonLine(candidate)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {getQueueSupportBadges(candidate).map((badge) => (
                      <Badge key={badge} variant="outline" className="bg-background px-2 py-0 text-[11px]">
                        {badge}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Updated</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatRelativeTime(candidate.liveReading.timestamp)}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
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
      </CardContent>
    </Card>
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

function buildLiveMetrics({
  isRunning,
  clinicalSummary,
  liveReadings,
  recentAlerts,
}: {
  isRunning: boolean
  clinicalSummary: ClinicalSummaryMetrics
  liveReadings: LiveReading[]
  recentAlerts: AlertNotification[]
}) {
  const updatedLastMinute = liveReadings.filter((reading) => isWithinWindow(reading.timestamp, LIVE_WINDOW_MS)).length
  const recentEscalationPatients = new Set(
    recentAlerts
      .filter((alert) => isWithinWindow(alert.timestamp, ALERT_WINDOW_MS))
      .map((alert) => alert.patient_id),
  )
  const activePatternCount = liveReadings.filter((reading) => reading.event).length

  return [
    {
      label: "Context-elevated gaps",
      value: String(clinicalSummary.contextElevatedGapCount),
      detail: isRunning
        ? `${updatedLastMinute} records refreshed in the last minute`
        : "Open gaps elevated by live context",
      variant: "critical",
    },
    {
      label: "Patients needing intervention",
      value: String(clinicalSummary.interventionPatientCount),
      detail:
        activePatternCount > 0
          ? `${activePatternCount} patients showing live pressure`
          : "Patients needing outreach or review",
      variant: "warning",
    },
    {
      label: "Measures under pressure",
      value: String(clinicalSummary.pressuredMeasureCount),
      detail:
        clinicalSummary.pressuredMeasureLabels.length > 0
          ? `${clinicalSummary.pressuredMeasureLabels.join(", ")} under pressure`
          : recentEscalationPatients.size > 0
            ? `${recentEscalationPatients.size} priorities changed recently`
            : "Measures with unresolved burden",
    },
  ] satisfies LiveMetric[]
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
    suggestedActions: deriveSuggestedActions(primaryAlert, liveReading, thresholdBreaches),
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

function deriveSuggestedActions(
  primaryAlert: PatientAlert | null,
  liveReading: LiveReading | undefined,
  thresholdBreaches: ThresholdBreach[],
) {
  const actions = new Set<string>(primaryAlert?.suggested_actions.slice(0, 3) ?? [])

  if (liveReading?.event === "hypoglycemia") {
    actions.add("Check point-of-care glucose and review insulin timing")
    actions.add("Confirm the patient is alert, oriented, and able to take oral carbohydrates")
  }

  if (liveReading?.event === "sepsis") {
    actions.add("Evaluate for infection source and obtain cultures")
    actions.add("Escalate to the attending team for sepsis workup")
  }

  thresholdBreaches.forEach((breach) => {
    if (breach.vital === "spo2") actions.add("Assess oxygenation and respiratory status")
    if (breach.vital === "heart_rate") actions.add("Review hemodynamics and medication effect")
    if (breach.vital === "respiratory_rate") actions.add("Check for metabolic or pulmonary decompensation")
  })

  if (actions.size === 0) {
    actions.add("Open the patient chart and review recent trajectory")
    actions.add("Confirm whether the live pattern is sustained across the last readings")
  }

  return Array.from(actions).slice(0, 4)
}

function getPrimaryConcern(candidate: EscalationCandidate) {
  const topGap = candidate.topGap
  const measureMeta = topGap ? getCareGapMeasureMeta(topGap.hedis_measure) : null
  const urgency = getGapUrgencyDriver(candidate)
  const contextSummary = getGapContextSummary(candidate.patient, topGap?.hedis_measure)

  if (topGap) {
    const title = `${getCareGapMeasureDashboardLabel(topGap.hedis_measure)} requires intervention`
    const gapName = measureMeta?.name ?? topGap.measure_name
    const contextSentence = contextSummary
      ? ` ${contextSummary}`
      : " This case has enough context to justify immediate outreach."

    return {
      title,
      summary: `${gapName} remains open. ${urgency}${contextSentence}`,
    }
  }

  return {
    title: candidate.primaryAlert?.title ?? "Rapid review recommended",
    summary:
      candidate.primaryAlert?.reasoning ??
      "Live vitals and patient context indicate this case should be reviewed before the rest of the queue.",
  }
}

function deriveInterventionActions(candidate: EscalationCandidate) {
  const topGap = candidate.topGap
  const firstBreach = candidate.thresholdBreaches[0]
  const actions: string[] = []

  if (topGap) {
    actions.push(getCareGapMeasureActionLabel(topGap.hedis_measure))
  }

  if (candidate.eventLabel === "Hypoglycemia") {
    actions.push("Initiate same-day outreach and confirm glucose review plan")
  } else if (candidate.eventLabel === "Sepsis") {
    actions.push("Route to clinician review immediately for infection assessment")
  } else if (firstBreach) {
    actions.push(
      `Route to clinician review because ${VITAL_CONFIG[firstBreach.vital].label} is ${firstBreach.direction} the personalized threshold`,
    )
  }

  if (actions.length === 0 && topGap) {
    getMeasureSpecificInterventions(candidate, topGap.hedis_measure).forEach((action) => {
      if (!actions.includes(action)) {
        actions.push(action)
      }
    })
  }

  if (actions.length === 0) {
    actions.push("Open the patient chart and confirm the next gap-closure action")
  }

  return actions.slice(0, 2)
}

function getMeasureSpecificInterventions(candidate: EscalationCandidate, measure: string) {
  const { patient } = candidate

  if (measure === "CDC-HBA") {
    return [
      patient.flags.has_insulin
        ? "Confirm glycemic follow-up timing if glucose instability continues"
        : "Confirm diabetes follow-up is active before routing outreach",
    ]
  }

  if (measure === "KED") {
    return [
      patient.flags.has_ckd
        ? "Prioritize eGFR and uACR completion"
        : "Confirm kidney monitoring is not already pending",
    ]
  }

  if (measure === "CBP") {
    return [
      "Confirm blood pressure follow-up and control plan",
    ]
  }

  if (measure === "SPD") {
    return [
      "Review statin therapy gap and route medication follow-up",
    ]
  }

  if (measure === "EED") {
    return [
      "Initiate retinal exam outreach and close the referral loop",
    ]
  }

  return []
}

function getPatientContextSummary(patient: Patient360) {
  const contextBits = [
    patient.flags.has_beta_blocker ? "beta-blocker therapy" : null,
    patient.flags.has_insulin ? "insulin-treated diabetes" : null,
    patient.flags.has_ckd ? "CKD context" : null,
    patient.conditions[0]?.display ?? null,
  ].filter(Boolean)

  return contextBits.slice(0, 3).join(", ")
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
  const parts: string[] = []
  const topGap = candidate.topGap

  if (topGap) {
    parts.push(`${getCareGapMeasureDashboardLabel(topGap.hedis_measure)} gap`)
  }

  parts.push(getCandidateContextAmplifier(candidate))
  parts.push(getCandidateClinicalAmplifier(candidate))

  return parts.filter(Boolean).slice(0, 3).join(" • ")
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
  const topGap = candidate.topGap

  if (topGap) {
    badges.push(topGap.hedis_measure)
  }

  badges.push(...getPatientContextBadges(candidate.patient).slice(0, 2))

  return badges.slice(0, 3)
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

function getGapUrgencyDriver(candidate: EscalationCandidate) {
  const firstBreach = candidate.thresholdBreaches[0]

  if (candidate.eventLabel === "Sepsis") {
    return "A sepsis-like pattern is increasing the urgency of intervention."
  }

  if (candidate.eventLabel === "Hypoglycemia") {
    return "A hypoglycemia-like pattern is making routine follow-up too slow."
  }

  if (firstBreach) {
    return `${VITAL_CONFIG[firstBreach.vital].label} is ${firstBreach.direction} the personalized threshold.`
  }

  if (candidate.primaryAlert?.title) {
    return `${candidate.primaryAlert.title} is raising intervention urgency.`
  }

  return "Current patient context is raising intervention urgency."
}

function getGapContextSummary(patient: Patient360, measure?: string) {
  if (!measure) {
    return `${getPatientContextSummary(patient)}`
  }

  if (measure === "CDC-HBA") {
    return patient.flags.has_insulin
      ? "Insulin-treated diabetes and current instability increase the value of timely glycemic follow-up."
      : "Diabetes context keeps glycemic follow-up tied to quality performance."
  }

  if (measure === "KED") {
    return patient.flags.has_ckd
      ? "CKD context means delayed kidney monitoring may affect both outcomes and HEDIS performance."
      : "Renal follow-up is still important for diabetic quality management."
  }

  if (measure === "CBP") {
    return "Hypertension and diabetes context increase the value of closing blood pressure follow-up promptly."
  }

  if (measure === "SPD") {
    return "Medication optimization affects both cardiovascular prevention and quality performance."
  }

  if (measure === "EED") {
    return "Diabetes context keeps retinal screening important for preventive quality performance."
  }

  return `${getPatientContextSummary(patient)}`
}

function getWhySurfacedReasons(candidate: EscalationCandidate) {
  const reasons: string[] = []
  const topGap = candidate.topGap

  if (topGap) {
    reasons.push(
      `${getCareGapMeasureDashboardLabel(topGap.hedis_measure)} is still open and ${topGap.days_overdue} day${topGap.days_overdue === 1 ? "" : "s"} overdue.`,
    )
  }

  reasons.push(
    `${getCandidateContextAmplifier(candidate)} is now paired with ${lowercaseFirst(getCandidateClinicalAmplifier(candidate))}.`,
  )

  if (reasons.length === 0) {
    reasons.push("Combined live drift and clinical context are keeping this patient at the top of the board.")
  }

  return reasons.slice(0, 2)
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
