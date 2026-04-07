"use client"

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Clock3,
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
}

type LiveEventItem = {
  id: string
  severity: Severity
  title: string
  detail: string
  timestamp: string
  href: string
  source: string
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

type HospitalRiskSummary = {
  id: Patient360["source_hospital"]
  name: string
  patients: number
  conditions: number
  medications: number
  labs: number
  encounters: number
  highAcuityPatients: number
  emergingRiskPatients: number
  careGapPressure: number
}

type ClinicalSummaryMetrics = {
  emergingRiskCount: number
  activeHighAcuityPatientsCount: number
  criticalEscalationsCount: number
  highEscalationsCount: number
  contextElevatedCareGapCount: number
  contextElevatedPatientCount: number
}

type CardTrend = {
  direction: "up" | "down" | "neutral"
  value: number
  label: string
  format?: "delta" | "plain"
}

export function DashboardOverview() {
  const { dataVersion } = useDemo()
  const { isRunning, tickCount, patientCount, liveReadings, recentAlerts, sessionAlertCount } = useSimulation()
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

  const totalPatients = patients.length

  const liveMetrics = React.useMemo(
    () => buildLiveMetrics({
      isRunning,
      tickCount,
      patientCount,
      liveReadings: liveReadingsList,
      recentAlerts,
      sessionAlertCount,
      totalPatients,
    }),
    [isRunning, tickCount, patientCount, liveReadingsList, recentAlerts, sessionAlertCount, totalPatients],
  )

  const clinicalSummary = React.useMemo(
    () => buildClinicalSummaryMetrics(patients, liveReadings),
    [patients, liveReadings],
  )

  const rankedEscalations = React.useMemo(
    () => rankEscalationPatients(patients, liveReadings, recentAlerts),
    [patients, liveReadings, recentAlerts],
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

  const liveFeed = React.useMemo(
    () => buildLiveEventFeed(patients, liveReadings, recentAlerts),
    [patients, liveReadings, recentAlerts],
  )

  const hospitalRisk = React.useMemo(
    () => buildHospitalRiskSummary(patients, liveReadings),
    [patients, liveReadings],
  )

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
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Clinical Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Prioritize deterioration, high-acuity patients, and follow-up burden across connected hospital populations.
        </p>
      </div>

      <LiveCommandBar isRunning={isRunning} metrics={liveMetrics} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatsCard
          title="Emerging Risk"
          value={clinicalSummary.emergingRiskCount}
          description="Patients showing multi-signal deterioration without an active critical or high alert"
          icon={Users}
          trend={null}
        />
        <StatsCard
          title="Active Critical/High Patients"
          value={clinicalSummary.activeHighAcuityPatientsCount}
          description={`${clinicalSummary.criticalEscalationsCount} critical alerts, ${clinicalSummary.highEscalationsCount} high alerts`}
          icon={AlertTriangle}
          trend={null}
          variant="critical"
        />
        <StatsCard
          title="Care Gaps Elevated by Context"
          value={clinicalSummary.contextElevatedCareGapCount}
          description={`${clinicalSummary.contextElevatedPatientCount} patients currently carrying combined burden`}
          icon={ClipboardList}
          trend={null}
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <TopEscalationCard candidate={topEscalation} />
        <ReviewQueueCard
          candidates={reviewQueue}
          onSelectPatient={(patientId) => setSelectedPriorityPatientId(patientId)}
        />
      </div>

      <HospitalRiskCard rows={hospitalRisk} />

      <LiveEventFeedCard events={liveFeed} />
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
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4 text-primary" />
              Live Monitoring
            </CardTitle>
            <CardDescription>
              Current activity across monitored patients.
            </CardDescription>
          </div>
          <Badge
            variant={isRunning ? "default" : "secondary"}
            className={cn(
              "w-fit rounded-full px-2.5 py-1 text-xs",
              isRunning && "bg-emerald-500 text-white hover:bg-emerald-500",
            )}
          >
            {isRunning ? "Simulation live" : "Standing by"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg border border-border/60 bg-background/70 p-3"
          >
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {metric.label}
            </p>
            <p className="mt-1 text-2xl font-semibold">{metric.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
          </div>
        ))}
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

  return (
    <Card className="border-destructive/30 bg-gradient-to-br from-destructive/5 via-background to-background">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Priority Review</CardTitle>
              <Badge variant="destructive">{priorityLabel}</Badge>
              <Badge variant="outline">Urgency score {score}</Badge>
              {contextBadges.slice(0, 3).map((badge) => (
                <Badge key={badge} variant="outline">
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
        <div className="rounded-lg border border-destructive/20 bg-background/90 p-3">
          <p className="text-sm font-medium text-foreground">
            {primaryAlert?.title ?? "Rapid review recommended"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {primaryAlert?.reasoning ??
              "Live vitals and existing context indicate this patient should be reviewed before the rest of the queue."}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(VITAL_CONFIG) as VitalKey[]).map((key) => {
            const readingValue = liveReading[key]
            const threshold = patient.personalized_thresholds[key]
            const breach = thresholdBreaches.find((item) => item.vital === key)
            return (
              <div key={key} className="rounded-lg border bg-background/80 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {VITAL_CONFIG[key].label}
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className={cn("text-2xl font-semibold", breach && "text-destructive")}>
                    {formatVitalValue(key, readingValue)}
                  </span>
                  <span className="text-xs text-muted-foreground">{VITAL_CONFIG[key].unit}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Threshold {formatThresholdRange(threshold.low, threshold.high)}
                </p>
                {breach && (
                  <p className="mt-1 text-xs font-medium text-destructive">
                    {capitalize(breach.direction)} threshold breach
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-lg border bg-background/80 p-4">
            <p className="text-sm font-medium">Clinical drivers</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {liveSignals.slice(0, 5).map((signal) => (
                <Badge key={signal} variant="outline" className="bg-background">
                  {signal}
                </Badge>
              ))}
              {liveSignals.length === 0 && (
                <Badge variant="outline" className="bg-background">
                  Monitoring for additional drift
                </Badge>
              )}
            </div>
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
              <p>{topContext}</p>
              <p>
                {candidate.eventLabel
                  ? `${candidate.eventLabel} pattern detected in the live stream.`
                  : "No single simulated event flag is dominant, but the combined context still increases urgency."}
              </p>
              <p>
                {candidate.overdueGapCount > 0
                  ? `${candidate.overdueGapCount} open care gap${candidate.overdueGapCount > 1 ? "s" : ""} increase follow-up burden.`
                  : "Current burden is driven primarily by physiologic change rather than preventive follow-up."}
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-background/80 p-4">
            <p className="text-sm font-medium">Recommended next actions</p>
            <div className="mt-3 space-y-2">
              {suggestedActions.map((action) => (
                <div
                  key={action}
                  className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                >
                  {action}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{candidate.recentAlertCount} new alert{candidate.recentAlertCount === 1 ? "" : "s"} this session</span>
              <span>{formatRelativeTime(liveReading.timestamp)}</span>
            </div>
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
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4 text-primary" />
          Review Queue
        </CardTitle>
        <CardDescription>
          Highest-urgency cases waiting behind the current review. Select a patient to load the full detail panel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {candidates.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No additional cases are waiting in the queue.</p>
        ) : (
          candidates.slice(0, 5).map((candidate, index) => (
            <button
              key={candidate.patient.patient_id}
              type="button"
              onClick={() => onSelectPatient(candidate.patient.patient_id)}
              className="w-full rounded-lg border border-border/70 bg-background/80 p-3 text-left transition-colors hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{candidate.patient.demographics.name}</p>
                    <Badge variant="outline">#{index + 1}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {candidate.patient.hospital_name} • {candidate.patient.demographics.age}y{" "}
                    {candidate.patient.demographics.gender === "female" ? "female" : "male"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {candidate.primaryAlert?.title ?? "Live deterioration requiring review"}
                  </p>
                </div>
                <Badge variant="secondary">Score {candidate.score}</Badge>
              </div>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function LiveEventFeedCard({ events }: { events: LiveEventItem[] }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4 text-primary" />
              Recent Clinical Changes
            </CardTitle>
            <CardDescription>
              New alerts, threshold crossings, and care-gap pressure as live data arrives.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/alerts" className="gap-1">
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No recent events yet. Start the simulator to watch new signals arrive.
          </p>
        ) : (
          events.slice(0, 7).map((event) => (
            <Link
              key={event.id}
              href={event.href}
              className="flex items-start gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-accent/40"
            >
              <Badge
                variant={event.severity === "critical" ? "destructive" : "outline"}
                className={cn(
                  "mt-0.5 shrink-0 capitalize",
                  event.severity === "high" && "border-warning/60 text-warning",
                )}
              >
                {event.severity}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">{event.title}</p>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {event.source}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{event.detail}</p>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatRelativeTime(event.timestamp)}
              </span>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function HospitalRiskCard({
  rows,
}: {
  rows: HospitalRiskSummary[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Unified Patient 360 By Hospital
        </CardTitle>
        <CardDescription>
          Hospital clinical bundles normalized into one operational model for conditions, medications, labs, encounters, and downstream monitoring.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 xl:grid-cols-3">
        {rows.map((row) => {
          return (
            <div key={row.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-sm text-muted-foreground">{row.patients} monitored patients in the shared Patient 360 model</p>
                </div>
                <Badge variant="outline">
                  FHIR-derived
                </Badge>
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Normalized clinical domains</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <HospitalMetric label="Conditions" value={row.conditions} />
                    <HospitalMetric label="Med orders" value={row.medications} />
                    <HospitalMetric label="Lab observations" value={row.labs} />
                    <HospitalMetric label="Encounters" value={row.encounters} />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Shared operational outputs</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <HospitalMetric label="High-acuity patients" value={row.highAcuityPatients} />
                    <HospitalMetric label="Emerging risk" value={row.emergingRiskPatients} />
                    <HospitalMetric label="Context-elevated gaps" value={row.careGapPressure} />
                    <HospitalMetric label="Patient 360 views" value={row.patients} />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function HospitalMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
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

function buildLiveMetrics({
  isRunning,
  tickCount,
  patientCount,
  liveReadings,
  recentAlerts,
  sessionAlertCount,
  totalPatients,
}: {
  isRunning: boolean
  tickCount: number
  patientCount: number
  liveReadings: LiveReading[]
  recentAlerts: AlertNotification[]
  sessionAlertCount: number
  totalPatients: number
}) {
  const monitoredCount = isRunning
    ? Math.max(patientCount, liveReadings.length, totalPatients)
    : totalPatients
  const updatedLastMinute = liveReadings.filter((reading) => isWithinWindow(reading.timestamp, LIVE_WINDOW_MS)).length
  const newAlertsThisSession = sessionAlertCount
  const newCriticalLastFive = recentAlerts.filter(
    (alert) => alert.severity === "critical" && isWithinWindow(alert.timestamp, ALERT_WINDOW_MS),
  ).length
  const activePatternCount = liveReadings.filter((reading) => reading.event).length
  const readingsProcessed = tickCount * Math.max(patientCount, liveReadings.length)

  return [
    {
      label: "Monitoring status",
      value: isRunning ? "Live" : "Idle",
      detail: isRunning ? "Simulation events are streaming into the dashboard." : "Start a run to watch patient state change in real time.",
    },
    {
      label: "Patients updated",
      value: String(updatedLastMinute),
      detail: "Received a fresh live reading in the last minute.",
    },
    {
      label: "Alerts this session",
      value: String(newAlertsThisSession),
      detail: "New notifications captured from the simulation stream.",
    },
    {
      label: "Critical in 5 min",
      value: String(newCriticalLastFive),
      detail: "Immediate escalation volume, refreshed continuously.",
    },
    {
      label: "Vitals processed",
      value: String(readingsProcessed || monitoredCount),
      detail: activePatternCount > 0 ? `${activePatternCount} patients currently showing a simulated event pattern.` : "Live readings are available for prioritization and context.",
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

function buildLiveEventFeed(
  patients: Patient360[],
  liveReadings: Map<string, LiveReading>,
  recentAlerts: AlertNotification[],
): LiveEventItem[] {
  const items: LiveEventItem[] = recentAlerts.map((alert) => ({
    id: `recent-${alert.id}`,
    severity: alert.severity,
    title: `${alert.patient_name}: ${alert.title}`,
    detail: alert.reasoning ?? `${capitalize(alert.severity)} alert detected by the CDS engine.`,
    timestamp: alert.timestamp,
    href: `/patients/${alert.patient_id}`,
    source: "live alert",
  }))

  patients.forEach((patient) => {
    const liveReading = liveReadings.get(patient.patient_id)
    if (!liveReading) return

    const thresholdBreaches = getThresholdBreaches(patient, liveReading)
    const topOverdueGap = patient.care_gaps
      .filter((gap) => gap.status === "open" && gap.days_overdue > 0)
      .sort((left, right) => right.days_overdue - left.days_overdue)[0]

    if (liveReading.event) {
      items.push({
        id: `event-${patient.patient_id}-${liveReading.timestamp}`,
        severity: liveReading.event === "sepsis" ? "critical" : "high",
        title: `${patient.demographics.name}: ${capitalize(liveReading.event)} pattern detected`,
        detail:
          liveReading.event === "sepsis"
            ? "Live stream is showing sepsis-like drift across multiple vitals."
            : "Live stream is showing a hypoglycemia-like pattern requiring review.",
        timestamp: liveReading.timestamp,
        href: `/patients/${patient.patient_id}`,
        source: "live vitals",
      })
    }

    if (thresholdBreaches.length > 0) {
      const breach = thresholdBreaches[0]
      items.push({
        id: `breach-${patient.patient_id}-${breach.vital}-${liveReading.timestamp}`,
        severity: breach.vital === "spo2" ? "critical" : "high",
        title: `${patient.demographics.name}: ${VITAL_CONFIG[breach.vital].label} crossed threshold`,
        detail: `${formatVitalValue(breach.vital, breach.current)} is ${breach.direction} the personalized boundary of ${breach.threshold}.`,
        timestamp: liveReading.timestamp,
        href: `/patients/${patient.patient_id}`,
        source: "threshold",
      })
    }

    if (topOverdueGap && hasLivePressure(patient, liveReading)) {
      items.push({
        id: `gap-${patient.patient_id}-${topOverdueGap.hedis_measure}`,
        severity: topOverdueGap.priority === "critical" ? "critical" : "high",
        title: `${patient.demographics.name}: ${topOverdueGap.hedis_measure} follow-up rising`,
        detail: `${topOverdueGap.measure_name} is overdue while live vitals show additional pressure.`,
        timestamp: liveReading.timestamp,
        href: `/patients/${patient.patient_id}`,
        source: "care gap",
      })
    }
  })

  if (items.length === 0) {
    return buildFallbackActivity(patients)
  }

  return items
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .filter((item, index, array) => array.findIndex((entry) => entry.id === item.id) === index)
}

function buildFallbackActivity(patients: Patient360[]): LiveEventItem[] {
  return patients
    .flatMap<LiveEventItem>((patient) => {
      const primaryAlert = patient.active_alerts[0]
      if (primaryAlert) {
        return [
          {
            id: `fallback-${primaryAlert.alert_id}`,
            severity: primaryAlert.severity as Severity,
            title: `${patient.demographics.name}: ${primaryAlert.title}`,
            detail: primaryAlert.reasoning,
            timestamp: primaryAlert.created_at,
            href: `/patients/${patient.patient_id}`,
            source: "existing alert",
          },
        ]
      }

      const overdueGap = patient.care_gaps
        .filter((gap) => gap.status === "open" && gap.days_overdue > 0)
        .sort((left, right) => right.days_overdue - left.days_overdue)[0]

      if (!overdueGap) return []
      return [
        {
          id: `fallback-gap-${patient.patient_id}-${overdueGap.hedis_measure}`,
          severity: overdueGap.priority === "critical" ? "critical" : "high",
          title: `${patient.demographics.name}: ${overdueGap.hedis_measure} overdue`,
          detail: `${overdueGap.measure_name} is ${overdueGap.days_overdue} day${overdueGap.days_overdue === 1 ? "" : "s"} overdue.`,
          timestamp: overdueGap.due_by,
          href: `/patients/${patient.patient_id}`,
          source: "care gap",
        },
      ]
    })
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
}

function buildHospitalRiskSummary(
  patients: Patient360[],
  liveReadings: Map<string, LiveReading>,
): HospitalRiskSummary[] {
  const hospitals: HospitalRiskSummary[] = [
    {
      id: "st_marys",
      name: "St. Mary's Medical Center",
      patients: 0,
      conditions: 0,
      medications: 0,
      labs: 0,
      encounters: 0,
      highAcuityPatients: 0,
      emergingRiskPatients: 0,
      careGapPressure: 0,
    },
    {
      id: "regional_general",
      name: "Regional General Hospital",
      patients: 0,
      conditions: 0,
      medications: 0,
      labs: 0,
      encounters: 0,
      highAcuityPatients: 0,
      emergingRiskPatients: 0,
      careGapPressure: 0,
    },
    {
      id: "community_health",
      name: "Community Health Partners",
      patients: 0,
      conditions: 0,
      medications: 0,
      labs: 0,
      encounters: 0,
      highAcuityPatients: 0,
      emergingRiskPatients: 0,
      careGapPressure: 0,
    },
  ]

  patients.forEach((patient) => {
    const liveReading = liveReadings.get(patient.patient_id)
    const target = hospitals.find((row) => row.id === patient.source_hospital)
    if (!target) return

    const hasSeriousAlert = hasSeriousActiveAlert(patient)
    const hasEmergingRisk = Boolean(liveReading && !hasSeriousAlert && hasLivePressure(patient, liveReading))

    target.patients += 1
    target.conditions += patient.conditions.length
    target.medications += patient.medications.length
    target.labs += patient.labs.length
    target.encounters += patient.encounters.length
    if (hasSeriousAlert) target.highAcuityPatients += 1
    if (hasEmergingRisk) target.emergingRiskPatients += 1
    target.careGapPressure += getContextElevatedCareGapCount(patient, liveReading)
  })

  return hospitals.sort((left, right) => getHospitalWorkloadScore(right) - getHospitalWorkloadScore(left))
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
): ClinicalSummaryMetrics {
  const emergingRiskPatients = new Set<string>()
  const activeHighAcuityPatients = new Set<string>()
  let criticalEscalationsCount = 0
  let highEscalationsCount = 0
  let contextElevatedCareGapCount = 0
  let contextElevatedPatientCount = 0

  patients.forEach((patient) => {
    const liveReading = liveReadings.get(patient.patient_id)
    const hasSeriousAlert = hasSeriousActiveAlert(patient)
    const contextElevatedCount = getContextElevatedCareGapCount(patient, liveReading)

    criticalEscalationsCount += patient.active_alerts.filter((alert) => alert.severity === "critical").length
    highEscalationsCount += patient.active_alerts.filter((alert) => alert.severity === "high").length
    contextElevatedCareGapCount += contextElevatedCount

    if (contextElevatedCount > 0) {
      contextElevatedPatientCount += 1
    }

    if (hasSeriousAlert) {
      activeHighAcuityPatients.add(patient.patient_id)
    }

    if (liveReading && !hasSeriousAlert && hasLivePressure(patient, liveReading)) {
      emergingRiskPatients.add(patient.patient_id)
    }
  })

  return {
    emergingRiskCount: emergingRiskPatients.size,
    activeHighAcuityPatientsCount: activeHighAcuityPatients.size,
    criticalEscalationsCount,
    highEscalationsCount,
    contextElevatedCareGapCount,
    contextElevatedPatientCount,
  }
}

function hasSeriousActiveAlert(patient: Patient360) {
  return patient.active_alerts.some((alert) => alert.severity === "critical" || alert.severity === "high")
}

function getContextElevatedCareGapCount(patient: Patient360, liveReading?: LiveReading) {
  if (!hasLivePressure(patient, liveReading)) return 0

  return patient.care_gaps.filter(
    (gap) => gap.status === "open" && (gap.days_overdue > 0 || gap.priority === "high" || gap.priority === "critical"),
  ).length
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

function getHospitalWorkloadScore(row: HospitalRiskSummary) {
  return row.highAcuityPatients * 3 + row.emergingRiskPatients * 2 + row.careGapPressure + row.patients
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
