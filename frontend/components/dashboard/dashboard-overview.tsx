"use client"

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Clock3,
  Database,
  GitCompare,
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

type ContextPair = {
  contextual: Patient360
  healthy: Patient360
}

type HospitalRiskSummary = {
  id: Patient360["source_hospital"]
  name: string
  patients: number
  critical: number
  high: number
  deteriorating: number
  overdue: number
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
  const criticalAlerts = patients.reduce(
    (sum, patient) => sum + patient.active_alerts.filter((alert) => alert.severity === "critical").length,
    0,
  )
  const highAlerts = patients.reduce(
    (sum, patient) => sum + patient.active_alerts.filter((alert) => alert.severity === "high").length,
    0,
  )
  const openCareGaps = patients.reduce(
    (sum, patient) => sum + patient.care_gaps.filter((gap) => gap.status === "open").length,
    0,
  )
  const overdueGaps = patients.reduce(
    (sum, patient) => sum + patient.care_gaps.filter((gap) => gap.days_overdue > 0).length,
    0,
  )

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

  const topEscalation = React.useMemo(
    () => selectTopEscalationPatient(patients, liveReadings, recentAlerts),
    [patients, liveReadings, recentAlerts],
  )

  const contextPair = React.useMemo(
    () => buildContextPair(patients, liveReadings, topEscalation?.patient ?? null),
    [patients, liveReadings, topEscalation],
  )

  const liveFeed = React.useMemo(
    () => buildLiveEventFeed(patients, liveReadings, recentAlerts),
    [patients, liveReadings, recentAlerts],
  )

  const hospitalRisk = React.useMemo(
    () => buildHospitalRiskSummary(patients, liveReadings),
    [patients, liveReadings],
  )

  const correlatedCareGaps = React.useMemo(
    () =>
      patients.reduce((sum, patient) => {
        const liveReading = liveReadings.get(patient.patient_id)
        const livePressure = hasLivePressure(patient, liveReading)
        if (!livePressure) return sum
        return (
          sum +
          patient.care_gaps.filter(
            (gap) => gap.status === "open" && (gap.days_overdue > 0 || gap.priority === "high" || gap.priority === "critical"),
          ).length
        )
      }, 0),
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
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Live command center for incoming vitals, contextual alerts, and operational follow-up.
        </p>
      </div>

      <LiveCommandBar isRunning={isRunning} metrics={liveMetrics} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          title="Total Patients"
          value={totalPatients}
          description={isRunning ? "Population under active monitoring" : "Ready for monitoring"}
          icon={Users}
          trend={{
            direction: liveMetrics[1]?.value !== "0" ? "up" : "neutral",
            value: parseMetricNumber(liveMetrics[1]?.value),
            label: "updated in last minute",
          }}
        />
        <StatsCard
          title="Critical Now"
          value={criticalAlerts}
          description="Immediate clinician attention"
          icon={AlertTriangle}
          trend={{
            direction: parseMetricNumber(liveMetrics[3]?.value) > 0 ? "up" : "neutral",
            value: parseMetricNumber(liveMetrics[3]?.value),
            label: "new in last 5 min",
          }}
          variant="critical"
        />
        <StatsCard
          title="High Now"
          value={highAlerts}
          description="Escalations pending review"
          icon={Activity}
          trend={{
            direction:
              recentAlerts.filter(
                (alert) => alert.severity === "high" && isWithinWindow(alert.timestamp, ALERT_WINDOW_MS),
              ).length > 0
                ? "up"
                : "neutral",
            value: recentAlerts.filter(
              (alert) => alert.severity === "high" && isWithinWindow(alert.timestamp, ALERT_WINDOW_MS),
            ).length,
            label: "new in last 5 min",
          }}
          variant="warning"
        />
        <StatsCard
          title="Care Gaps At Risk"
          value={openCareGaps}
          description={`${overdueGaps} overdue across the population`}
          icon={ClipboardList}
          trend={{
            direction: correlatedCareGaps > 0 ? "up" : "neutral",
            value: correlatedCareGaps,
            label: "paired with live drift",
          }}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <TopEscalationCard candidate={topEscalation} />
        <ContextMattersCard pair={contextPair} liveReadings={liveReadings} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <LiveEventFeedCard events={liveFeed} />
        <HospitalRiskCard rows={hospitalRisk} totalPatients={totalPatients} />
      </div>

      <MongoValueCard
        patientCount={totalPatients}
        hospitalCount={new Set(patients.map((patient) => patient.source_hospital)).size}
        activeReadings={liveReadingsList.length}
        alertsCount={criticalAlerts + highAlerts}
        openCareGapCount={openCareGaps}
        tickCount={tickCount}
        patientCountDuringRun={patientCount}
      />
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
              Live Command Bar
            </CardTitle>
            <CardDescription>
              What is changing right now across connected patients and hospital feeds.
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
            Top Escalation
          </CardTitle>
          <CardDescription>No clinically urgent escalations at the moment.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const { patient, primaryAlert, liveReading, thresholdBreaches, liveSignals, suggestedActions, score } = candidate
  const topContext = getPatientContextSummary(patient)

  return (
    <Card className="border-destructive/30 bg-gradient-to-br from-destructive/5 via-background to-background">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Top Escalation</CardTitle>
              <Badge variant="destructive">Priority {score}</Badge>
              <Badge variant="outline">{patient.profile_type}</Badge>
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
            <p className="text-sm font-medium">Why this patient is prioritized</p>
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
            <p className="text-sm font-medium">Suggested next actions</p>
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

function ContextMattersCard({
  pair,
  liveReadings,
}: {
  pair: ContextPair | null
  liveReadings: Map<string, LiveReading>
}) {
  if (!pair) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCompare className="h-4 w-4 text-primary" />
            Why Context Matters
          </CardTitle>
          <CardDescription>Need at least one contextual and one healthy patient to compare.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const contextualReading = getCurrentReading(pair.contextual, liveReadings.get(pair.contextual.patient_id))
  const healthyReading = getCurrentReading(pair.healthy, liveReadings.get(pair.healthy.patient_id))
  const contextualBreaches = getThresholdBreaches(pair.contextual, liveReadings.get(pair.contextual.patient_id))
  const healthyBreaches = getThresholdBreaches(pair.healthy, liveReadings.get(pair.healthy.patient_id))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompare className="h-4 w-4 text-primary" />
          Why Context Matters
        </CardTitle>
        <CardDescription>
          Similar vitals can lead to different clinical decisions once medications, conditions, and thresholds are applied.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
          Same-ish physiologic signal, different interpretation. That is the core story of the platform.
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <ComparisonPatientCard
            label="Context-rich patient"
            patient={pair.contextual}
            reading={contextualReading}
            breaches={contextualBreaches}
            emphasis="escalate"
          />
          <ComparisonPatientCard
            label="Healthy reference"
            patient={pair.healthy}
            reading={healthyReading}
            breaches={healthyBreaches}
            emphasis="monitor"
          />
        </div>
      </CardContent>
    </Card>
  )
}

function ComparisonPatientCard({
  label,
  patient,
  reading,
  breaches,
  emphasis,
}: {
  label: string
  patient: Patient360
  reading: CurrentReading
  breaches: ThresholdBreach[]
  emphasis: "escalate" | "monitor"
}) {
  const vitalsSummary = `${VITAL_CONFIG.heart_rate.label} ${formatVitalValue("heart_rate", reading.heart_rate)} • ${VITAL_CONFIG.spo2.label} ${formatVitalValue("spo2", reading.spo2)}`
  const primaryOutcome =
    patient.active_alerts.find((alert) => alert.severity === "critical" || alert.severity === "high")?.title ??
    (breaches.length > 0 ? "Threshold pressure detected" : "Continue monitoring")

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        emphasis === "escalate" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{label}</p>
        <Badge variant={emphasis === "escalate" ? "destructive" : "secondary"}>
          {emphasis === "escalate" ? "Escalate" : "Monitor"}
        </Badge>
      </div>
      <div className="mt-3">
        <p className="font-medium">{patient.demographics.name}</p>
        <p className="text-sm text-muted-foreground">
          {patient.profile_type} • {patient.hospital_name}
        </p>
      </div>
      <p className="mt-3 text-sm">{vitalsSummary}</p>
      <p className="mt-2 text-sm text-muted-foreground">{getPatientContextSummary(patient)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {breaches.length > 0 ? (
          breaches.slice(0, 2).map((breach) => (
            <Badge key={breach.vital} variant="outline">
              {VITAL_CONFIG[breach.vital].label} {breach.direction}
            </Badge>
          ))
        ) : (
          <Badge variant="outline">No active threshold breach</Badge>
        )}
      </div>
      <div className="mt-3 rounded-md border bg-background px-3 py-2 text-sm">
        <span className="font-medium">Outcome:</span> {primaryOutcome}
      </div>
    </div>
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
              What Changed Recently
            </CardTitle>
            <CardDescription>
              Incoming alerts, threshold crossings, and care-gap escalations.
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
  totalPatients,
}: {
  rows: HospitalRiskSummary[]
  totalPatients: number
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Hospital Risk Heatmap
        </CardTitle>
        <CardDescription>
          Which connected systems are carrying the highest alert and follow-up burden.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => {
          const intensity = totalPatients > 0 ? Math.round((row.patients / totalPatients) * 100) : 0
          return (
            <div key={row.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-sm text-muted-foreground">{row.patients} monitored patients</p>
                </div>
                <Badge variant={row.critical > 0 ? "destructive" : "secondary"}>
                  {row.critical > 0 ? `${row.critical} critical` : "stable"}
                </Badge>
              </div>
              <div className="mt-3 h-2 rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full",
                    row.critical > 0 ? "bg-destructive" : row.high > 0 ? "bg-warning" : "bg-emerald-500",
                  )}
                  style={{ width: `${Math.max(intensity, 8)}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <HospitalMetric label="High alerts" value={row.high} />
                <HospitalMetric label="Deteriorating now" value={row.deteriorating} />
                <HospitalMetric label="Overdue gaps" value={row.overdue} />
                <HospitalMetric label="Critical now" value={row.critical} />
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

function MongoValueCard({
  patientCount,
  hospitalCount,
  activeReadings,
  alertsCount,
  openCareGapCount,
  tickCount,
  patientCountDuringRun,
}: {
  patientCount: number
  hospitalCount: number
  activeReadings: number
  alertsCount: number
  openCareGapCount: number
  tickCount: number
  patientCountDuringRun: number
}) {
  const approximatedReadings = tickCount * Math.max(patientCountDuringRun, activeReadings)

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4 text-primary" />
          Why MongoDB Here
        </CardTitle>
        <CardDescription>
          The dashboard is reading one operational view that merges hospital context, live vitals, alerts, and care gaps.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ValueChip label="Hospital feeds" value={String(hospitalCount)} detail="Epic, Cerner, and legacy-derived context" />
          <ValueChip
            label="Patient 360 docs"
            value={String(patientCount)}
            detail="Denormalized read model for fast clinician queries"
          />
          <ValueChip
            label="Live vitals seen"
            value={String(approximatedReadings)}
            detail="Approximate readings processed in this run"
          />
          <ValueChip
            label="Contextual workload"
            value={String(alertsCount + openCareGapCount)}
            detail="Alerts and care gaps unified on the same patient view"
          />
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">Unified operational document</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Each patient view blends demographics, conditions, medications, thresholds, current vitals, active alerts, and care gaps without asking the frontend to perform joins.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">Live plus historical context</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Incoming wearable readings show motion, while the stored Patient 360 provides the clinical background needed to interpret the same vital sign differently for each patient.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">Actionable, not just observable</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The goal is not to count alerts. It is to prioritize what clinicians should do next using context-aware thresholds and operational follow-up state in one place.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ValueChip({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
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
  trend: {
    direction: "up" | "down" | "neutral"
    value: number
    label: string
  } | null
  variant?: "default" | "critical" | "warning"
}) {
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
          {trend && trend.value > 0 && (
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
            {trend.value > 0 ? `+${trend.value}` : "0"} {trend.label}
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

function selectTopEscalationPatient(
  patients: Patient360[],
  liveReadings: Map<string, LiveReading>,
  recentAlerts: AlertNotification[],
): EscalationCandidate | null {
  const ranked = patients
    .map((patient) => buildEscalationCandidate(patient, liveReadings.get(patient.patient_id), recentAlerts))
    .filter((candidate): candidate is EscalationCandidate => candidate !== null)
    .sort((left, right) => right.score - left.score)

  return ranked[0] ?? null
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

function buildContextPair(
  patients: Patient360[],
  liveReadings: Map<string, LiveReading>,
  featuredPatient: Patient360 | null,
): ContextPair | null {
  const contextual =
    featuredPatient ??
    patients.find((patient) => patient.profile_type === "target" || patient.flags.has_ckd || patient.flags.has_beta_blocker) ??
    null
  if (!contextual) return null

  const contextualReading = getCurrentReading(contextual, liveReadings.get(contextual.patient_id))
  const healthyCandidates = patients.filter(
    (patient) => patient.patient_id !== contextual.patient_id && patient.profile_type === "healthy",
  )

  if (healthyCandidates.length === 0) return null

  const healthy = healthyCandidates
    .map((candidate) => {
      const reading = getCurrentReading(candidate, liveReadings.get(candidate.patient_id))
      const similarity =
        Math.abs(reading.heart_rate - contextualReading.heart_rate) +
        Math.abs(reading.spo2 - contextualReading.spo2) * 3 +
        Math.abs(reading.respiratory_rate - contextualReading.respiratory_rate) * 2
      return { candidate, similarity }
    })
    .sort((left, right) => left.similarity - right.similarity)[0]?.candidate

  return healthy ? { contextual, healthy } : null
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
    { id: "st_marys", name: "St. Mary's Medical Center", patients: 0, critical: 0, high: 0, deteriorating: 0, overdue: 0 },
    { id: "regional_general", name: "Regional General Hospital", patients: 0, critical: 0, high: 0, deteriorating: 0, overdue: 0 },
    { id: "community_health", name: "Community Health Partners", patients: 0, critical: 0, high: 0, deteriorating: 0, overdue: 0 },
  ]

  patients.forEach((patient) => {
    const target = hospitals.find((row) => row.id === patient.source_hospital)
    if (!target) return
    target.patients += 1
    target.critical += patient.active_alerts.filter((alert) => alert.severity === "critical").length
    target.high += patient.active_alerts.filter((alert) => alert.severity === "high").length
    target.overdue += patient.care_gaps.filter((gap) => gap.status === "open" && gap.days_overdue > 0).length
    if (hasLivePressure(patient, liveReadings.get(patient.patient_id))) {
      target.deteriorating += 1
    }
  })

  return hospitals.sort((left, right) => {
    const leftScore = left.critical * 3 + left.high * 2 + left.deteriorating + left.overdue
    const rightScore = right.critical * 3 + right.high * 2 + right.deteriorating + right.overdue
    return rightScore - leftScore
  })
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

function parseMetricNumber(value?: string) {
  const parsed = Number.parseInt(value ?? "0", 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

function capitalize(value: string) {
  if (!value) return value
  return `${value[0].toUpperCase()}${value.slice(1)}`
}
