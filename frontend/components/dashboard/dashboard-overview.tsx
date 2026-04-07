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
import { type Alert as PatientAlert, type Patient360 } from "@/lib/mock-data"
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
  primaryAlert: PatientAlert | null
  liveReading: CurrentReading
  liveSignals: string[]
  thresholdBreaches: ThresholdBreach[]
  overdueGapCount: number
  recentAlertCount: number
  eventLabel: string | null
  suggestedActions: string[]
}

type ClinicalSummaryMetrics = {
  immediateReviewCount: number
  watchlistCount: number
  newEscalationsCount: number
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
        <h1 className="text-2xl font-semibold tracking-tight">Clinical Operations</h1>
        <p className="text-sm text-muted-foreground">
          Review the top case and work the next patients in line.
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
      <CardContent className="px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-primary" />
              <span className="text-sm font-medium">Board Status</span>
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

          <div className="grid gap-2 md:grid-cols-3 xl:flex-1 xl:grid-cols-3 xl:gap-0">
            {metrics.map((metric, index) => (
              <div
                key={metric.label}
                className={cn(
                  "flex min-h-[76px] flex-col justify-between rounded-md px-3 py-2 xl:rounded-none",
                  index > 0 && "xl:border-l xl:border-border/60",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {metric.label}
                  </p>
                  <p
                    className={cn(
                      "text-2xl font-semibold leading-none",
                      metric.variant === "critical" && "text-destructive",
                      metric.variant === "warning" && "text-warning",
                    )}
                  >
                    {metric.value}
                  </p>
                </div>
                <p className="mt-1 min-h-[32px] text-xs leading-4 text-muted-foreground">
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
            Priority Review
          </CardTitle>
          <CardDescription>No clinically urgent escalations at the moment.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const { patient, primaryAlert, liveReading, thresholdBreaches, liveSignals, suggestedActions, score } = candidate
  const topContext = getPatientContextSummary(patient)
  const contextBadges = getPatientContextBadges(patient)
  const priorityLabel = getPriorityReviewLabel(score)
  const whySurfaced = getWhySurfacedReasons(candidate)
  const currentSignals = getPrioritySignals(candidate)
  const primaryConcern =
    primaryAlert?.reasoning ??
    "Live vitals and patient context indicate this case should be reviewed before the rest of the queue."

  return (
    <Card className="border-border/60 bg-white shadow-sm">
      <CardHeader className="gap-2 pb-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Priority Review</CardTitle>
              <Badge variant="destructive">{priorityLabel}</Badge>
              <Badge variant="outline">Top of queue</Badge>
              {contextBadges.slice(0, 3).map((badge) => (
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
            {primaryAlert?.title ?? "Rapid review recommended"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {primaryConcern}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="h-full rounded-lg border border-border/60 bg-white p-3 shadow-sm">
            <p className="text-sm font-medium">Current signals</p>
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
            <p className="text-sm font-medium">Why surfaced</p>
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
            {suggestedActions.slice(0, 2).map((action, index) => (
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
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4 text-primary" />
          Review Queue
        </CardTitle>
        <CardDescription className="text-xs leading-5">
          The next patients to work after the current case.
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
                    <Badge variant={candidate.score >= 280 ? "destructive" : "secondary"}>
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
      label: "Immediate review",
      value: String(clinicalSummary.immediateReviewCount),
      detail: isRunning
        ? `${updatedLastMinute} patients refreshed in the last minute.`
        : "High-priority patients waiting for follow-up right now.",
      variant: "critical",
    },
    {
      label: "Watchlist",
      value: String(clinicalSummary.watchlistCount),
      detail:
        activePatternCount > 0
          ? `${activePatternCount} patients are showing a notable live pattern.`
          : "Patients with drift are being monitored for sustained change.",
      variant: "warning",
    },
    {
      label: "New escalations",
      value: String(clinicalSummary.newEscalationsCount),
      detail:
        recentEscalationPatients.size > 0
          ? `${recentEscalationPatients.size} patients moved because of recent alerts.`
          : "No new high-priority movement in the last few minutes.",
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
    .sort((left, right) => right.score - left.score)
}

function buildEscalationCandidate(
  patient: Patient360,
  liveReading: LiveReading | undefined,
  recentAlerts: AlertNotification[],
): EscalationCandidate | null {
  const criticalAlerts = patient.active_alerts.filter((alert) => alert.severity === "critical")
  const highAlerts = patient.active_alerts.filter((alert) => alert.severity === "high")
  const primaryAlert = criticalAlerts[0] ?? highAlerts[0] ?? patient.active_alerts[0] ?? null
  const thresholdBreaches = getThresholdBreaches(patient, liveReading)
  const liveSignals = getVitalsRiskSignals(patient, liveReading)
  const overdueGapCount = patient.care_gaps.filter((gap) => gap.status === "open" && gap.days_overdue > 0).length
  const sessionAlerts = recentAlerts.filter((alert) => alert.patient_id === patient.patient_id)
  const liveEventBoost = liveReading?.event ? 35 : 0
  const score =
    criticalAlerts.length * 100 +
    highAlerts.length * 60 +
    thresholdBreaches.length * 24 +
    liveSignals.length * 12 +
    overdueGapCount * 14 +
    sessionAlerts.length * 10 +
    liveEventBoost

  if (score <= 0) {
    return null
  }

  return {
    patient,
    score,
    primaryAlert,
    liveReading: getCurrentReading(patient, liveReading),
    liveSignals,
    thresholdBreaches,
    overdueGapCount,
    recentAlertCount: sessionAlerts.length,
    eventLabel: liveReading?.event ? capitalize(liveReading.event) : null,
    suggestedActions: deriveSuggestedActions(primaryAlert, liveReading, thresholdBreaches),
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

function buildClinicalSummaryMetrics(
  patients: Patient360[],
  liveReadings: Map<string, LiveReading>,
  recentAlerts: AlertNotification[],
  rankedEscalations: EscalationCandidate[],
): ClinicalSummaryMetrics {
  const immediateReviewPatients = new Set(
    rankedEscalations
      .filter((candidate) => isImmediateReviewCandidate(candidate))
      .map((candidate) => candidate.patient.patient_id),
  )
  const watchlistPatients = new Set<string>()
  const newEscalationPatients = new Set(
    recentAlerts
      .filter((alert) => isWithinWindow(alert.timestamp, ALERT_WINDOW_MS))
      .map((alert) => alert.patient_id),
  )

  patients.forEach((patient) => {
    const liveReading = liveReadings.get(patient.patient_id)
    if (!liveReading || immediateReviewPatients.has(patient.patient_id)) return
    if (hasLivePressure(patient, liveReading)) watchlistPatients.add(patient.patient_id)
  })

  return {
    immediateReviewCount: immediateReviewPatients.size,
    watchlistCount: watchlistPatients.size,
    newEscalationsCount: newEscalationPatients.size,
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
  return hasSeriousActiveAlert(candidate.patient) || candidate.score >= 160
}

function getCandidateReasonLine(candidate: EscalationCandidate) {
  const parts: string[] = []
  const firstBreach = candidate.thresholdBreaches[0]

  if (firstBreach) {
    parts.push(`${VITAL_CONFIG[firstBreach.vital].label} ${firstBreach.direction} personalized threshold`)
  } else if (candidate.eventLabel) {
    parts.push(`${candidate.eventLabel} pattern detected`)
  } else if (candidate.primaryAlert?.title) {
    parts.push(candidate.primaryAlert.title)
  }

  const contextBadge = getPatientContextBadges(candidate.patient)[0]
  if (contextBadge) parts.push(contextBadge)

  if (candidate.overdueGapCount > 0) {
    parts.push(`${candidate.overdueGapCount} open care gap${candidate.overdueGapCount === 1 ? "" : "s"}`)
  }

  return parts.slice(0, 3).join(" • ")
}

function getQueueSupportBadges(candidate: EscalationCandidate) {
  const badges = getPatientContextBadges(candidate.patient).slice(0, 2)

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

function getWhySurfacedReasons(candidate: EscalationCandidate) {
  const reasons: string[] = []
  const firstBreach = candidate.thresholdBreaches[0]

  if (firstBreach) {
    reasons.push(
      `${VITAL_CONFIG[firstBreach.vital].label} is ${firstBreach.direction} the personalized boundary of ${firstBreach.threshold}.`,
    )
  }

  if (candidate.eventLabel) {
    reasons.push(`${candidate.eventLabel} pattern detected in the live stream.`)
  } else if (candidate.liveSignals.length > 0) {
    reasons.push(`${candidate.liveSignals[0]} is reinforcing the current priority.`)
  }

  if (candidate.overdueGapCount > 0) {
    reasons.push(
      `${candidate.overdueGapCount} open care gap${candidate.overdueGapCount === 1 ? "" : "s"} add follow-up burden to the current change.`,
    )
  }

  if (reasons.length === 0) {
    reasons.push("Combined live drift and clinical context are keeping this patient at the top of the board.")
  }

  return reasons.slice(0, 2)
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
  if (score >= 450) return "Immediate review"
  if (score >= 280) return "Escalate now"
  if (score >= 160) return "High priority"
  return "Priority watch"
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
