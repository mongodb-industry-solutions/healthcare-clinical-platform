"use client"

import * as React from "react"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Activity as ActivityIcon,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  Heart,
  Info,
  Loader2,
  Minus,
  Shield,
  Stethoscope,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Wind,
  Zap,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { cn } from "@/lib/utils"
import {
  useSimulation,
  type AlertNotification,
  type LiveReading,
} from "@/lib/simulation-context"
import {
  type BaselineVitalDelta,
  fetchAllPatients,
  fetchLongitudinal,
  type LongitudinalResponse,
  type LongitudinalSnapshot,
  type RecommendedAction,
  type WorkbenchStatus,
} from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { Patient360 } from "@/lib/mock-data"

type VitalKey = "heart_rate" | "spo2" | "respiratory_rate" | "temperature"
type ThresholdMap = LongitudinalResponse["current_thresholds"]
type ThresholdBreach = {
  vitalKey: VitalKey
  label: string
  value: number
  threshold: number
  direction: "high" | "low"
  delta: number
}

const VITAL_CONFIG: Record<
  VitalKey,
  { label: string; unit: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  heart_rate: { label: "Heart Rate", unit: "bpm", icon: Heart, color: "hsl(0, 72%, 51%)" },
  spo2: { label: "SpO2", unit: "%", icon: ActivityIcon, color: "hsl(217, 91%, 60%)" },
  respiratory_rate: { label: "Resp Rate", unit: "/min", icon: Wind, color: "hsl(160, 60%, 45%)" },
  temperature: { label: "Temperature", unit: "°C", icon: Thermometer, color: "hsl(30, 80%, 55%)" },
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "hsl(0, 72%, 51%)",
  high: "hsl(25, 95%, 53%)",
  moderate: "hsl(45, 93%, 47%)",
  low: "hsl(220, 9%, 60%)",
}

const POLL_INTERVAL_MS = 10_000
const WORKBENCH_VITALS: VitalKey[] = ["heart_rate", "spo2", "respiratory_rate", "temperature"]

export function PatientComparison() {
  const { isRunning, liveReadings, recentAlerts, tickCount } = useSimulation()
  const [patients, setPatients] = React.useState<Patient360[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedPatientId, setSelectedPatientId] = React.useState<string | null>(null)
  const [selectedBaselineKey, setSelectedBaselineKey] = React.useState<string | null>(null)
  const [longitudinal, setLongitudinal] = React.useState<LongitudinalResponse | null>(null)
  const [longitudinalLoading, setLongitudinalLoading] = React.useState(false)
  const [loadMs, setLoadMs] = React.useState<number | null>(null)
  const [isPolling, setIsPolling] = React.useState(false)

  React.useEffect(() => {
    setLoading(true)
    fetchAllPatients({ limit: 500 })
      .then((data) => {
        setPatients(data)
        setError(null)
        setSelectedPatientId((prev) => {
          if (prev && data.some((p) => p.patient_id === prev)) return prev
          const target = data.find(
            (p) => p.profile_type === "target" && p.active_alerts.length > 0,
          )
          return target?.patient_id ?? data[0]?.patient_id ?? null
        })
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchData = React.useCallback((
    patientId: string,
    showSpinner: boolean,
    baselineKey?: string | null,
  ) => {
    if (showSpinner) setLongitudinalLoading(true)
    else setIsPolling(true)
    const t0 = performance.now()
    fetchLongitudinal(patientId, baselineKey)
      .then((data) => {
        setLoadMs(Math.round(performance.now() - t0))
        setLongitudinal(data)
        setSelectedBaselineKey((prev) =>
          data.selected_baseline_key && data.selected_baseline_key !== prev
            ? data.selected_baseline_key
            : prev,
        )
      })
      .catch(() => setLongitudinal(null))
      .finally(() => {
        setLongitudinalLoading(false)
        setIsPolling(false)
      })
  }, [])

  React.useEffect(() => {
    if (!selectedPatientId) return
    fetchData(selectedPatientId, true, selectedBaselineKey)
  }, [selectedPatientId, selectedBaselineKey, fetchData])

  React.useEffect(() => {
    if (!isRunning || !selectedPatientId) return
    const id = setInterval(
      () => fetchData(selectedPatientId, false, selectedBaselineKey),
      POLL_INTERVAL_MS,
    )
    return () => clearInterval(id)
  }, [isRunning, selectedPatientId, selectedBaselineKey, fetchData])

  const selectedPatient = patients.find((p) => p.patient_id === selectedPatientId) ?? null
  const patientLiveReading = selectedPatient
    ? liveReadings.get(selectedPatient.patient_id)
    : undefined
  const patientRecentAlerts = selectedPatient
    ? recentAlerts.filter((alert) => alert.patient_id === selectedPatient.patient_id).slice(0, 3)
    : []
  const historicalSnapshots = React.useMemo(
    () => (longitudinal ? getHistoricalBaselineSnapshots(longitudinal.snapshots) : []),
    [longitudinal],
  )
  const selectedBaseline = historicalSnapshots.find(
    (snapshot) => snapshot.period_key === selectedBaselineKey,
  ) ?? historicalSnapshots[0] ?? null

  React.useEffect(() => {
    if (historicalSnapshots.length === 0) {
      setSelectedBaselineKey(null)
      return
    }

    if (
      selectedBaselineKey &&
      historicalSnapshots.some((snapshot) => snapshot.period_key === selectedBaselineKey)
    ) {
      return
    }

    const defaultSnapshot =
      historicalSnapshots.find((snapshot) => snapshot.label === "1 Month")
      ?? historicalSnapshots[0]
    setSelectedBaselineKey(defaultSnapshot.period_key)
  }, [historicalSnapshots, selectedBaselineKey])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || patients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{error || "No patients available"}</p>
      </div>
    )
  }

  if (!selectedPatient) {
    return null
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Clinical Escalation Workbench
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review worsening signals, interpret them in clinical context, and decide what action
            the care team should take next.
          </p>
        </div>
        {isRunning && (
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Live {isPolling && "— refreshing..."}
            </span>
          </div>
        )}
      </div>

      <Alert className="bg-primary/5 border-primary/20">
        <Info className="h-4 w-4 text-primary" />
        <AlertTitle className="text-primary">Clinical Story</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          Historical windows establish baseline context. The current window refreshes from live
          vitals, then the workbench explains which signals are changing, why they matter for this
          patient, and what follow-up actions the team should prioritize
          {isRunning ? " while the simulation is active." : "."}
        </AlertDescription>
      </Alert>

      {/* Patient selector */}
      <PatientSelector
        selectedPatient={selectedPatient}
        onSelect={setSelectedPatientId}
        patients={patients}
      />

      {longitudinalLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : longitudinal && longitudinal.snapshots.length > 0 ? (
        <>
          <EscalationHeroCard
            patient={selectedPatient}
            snapshots={longitudinal.snapshots}
            thresholds={longitudinal.current_thresholds}
            liveReading={patientLiveReading}
            recentAlerts={patientRecentAlerts}
            tickCount={tickCount}
            selectedBaseline={selectedBaseline}
            currentStatus={longitudinal.current_status}
            baselineRiskDelta={longitudinal.baseline_risk_delta}
            baselineAlertDelta={longitudinal.baseline_alert_delta}
            clinicalSummary={longitudinal.clinical_summary}
          />

          <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
            <WhyNowCard
              patient={selectedPatient}
              snapshots={longitudinal.snapshots}
              thresholds={longitudinal.current_thresholds}
              liveReading={patientLiveReading}
              recentAlerts={patientRecentAlerts}
              selectedBaseline={selectedBaseline}
              topRiskDrivers={longitudinal.top_risk_drivers}
            />
            <RecommendedActionsCard
              patient={selectedPatient}
              actions={longitudinal.recommended_actions}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <CurrentSignalCard
              patient={selectedPatient}
              thresholds={longitudinal.current_thresholds}
              liveReading={patientLiveReading}
              thresholdBreaches={longitudinal.threshold_breaches}
            />
            <BaselineComparisonCard
              patient={selectedPatient}
              baselineOptions={historicalSnapshots}
              selectedBaseline={selectedBaseline}
              onSelectBaseline={setSelectedBaselineKey}
              thresholds={longitudinal.current_thresholds}
              liveReading={patientLiveReading}
              baselineRiskDelta={longitudinal.baseline_risk_delta}
              baselineAlertDelta={longitudinal.baseline_alert_delta}
              baselineVitalDeltas={longitudinal.baseline_vital_deltas}
              clinicalSummary={longitudinal.clinical_summary}
            />
          </div>

          {/* Clinical trajectory summary */}
          <TrajectoryCard
            snapshots={longitudinal.snapshots}
            profileType={longitudinal.profile_type}
            selectedBaseline={selectedBaseline}
          />

          {/* Risk score trend */}
          <RiskScoreChart snapshots={longitudinal.snapshots} selectedBaseline={selectedBaseline} />

          {/* 2x2 vitals trend grid */}
          <div className="grid gap-4 md:grid-cols-2">
            {(Object.keys(VITAL_CONFIG) as VitalKey[]).map((key) => (
              <VitalTrendChart
                key={key}
                vitalKey={key}
                snapshots={longitudinal.snapshots}
                threshold={longitudinal.current_thresholds[key]}
                selectedBaseline={selectedBaseline}
              />
            ))}
          </div>

          {/* Period comparison cards */}
          <PeriodCards snapshots={longitudinal.snapshots} selectedBaseline={selectedBaseline} />

          {/* Alert history timeline */}
          <AlertHistoryChart snapshots={longitudinal.snapshots} />

          {/* Clinical context */}
          <ClinicalContextCard snapshots={longitudinal.snapshots} profileType={longitudinal.profile_type} />

          <details className="group rounded-lg border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
              Technical proof for buyers and architects
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t p-4">
              {longitudinal.pipeline_display && (
                <PipelineShowcase
                  pipelineDisplay={longitudinal.pipeline_display}
                  aggregationMs={longitudinal.aggregation_ms}
                  readingsAnalyzed={
                    longitudinal.snapshots
                      .filter((s) => s.source === "live")
                      .reduce((sum, s) => sum + s.readings_analyzed, 0)
                  }
                />
              )}

              <WhyMongoDB
                loadMs={loadMs}
                aggregationMs={longitudinal.aggregation_ms}
                patientCount={patients.length}
                liveSnapshots={longitudinal.snapshots.filter((s) => s.source === "live")}
              />
            </div>
          </details>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No longitudinal data available for this patient.
              Re-seed the demo to generate trend analysis data.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Patient selector                                                   */
/* ------------------------------------------------------------------ */

function PatientSelector({
  selectedPatient,
  onSelect,
  patients,
}: {
  selectedPatient: Patient360
  onSelect: (id: string) => void
  patients: Patient360[]
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
        <Stethoscope className="h-3.5 w-3.5" />
        Select Patient
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-auto py-3 max-w-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-medium">
                {selectedPatient.demographics.given?.[0]}
                {selectedPatient.demographics.family?.[0]}
              </div>
              <div className="text-left">
                <div className="font-medium">{selectedPatient.demographics.name}</div>
                <div className="text-xs text-muted-foreground">
                  {selectedPatient.demographics.age}y{" "}
                  {selectedPatient.demographics.gender === "female" ? "F" : "M"} |{" "}
                  {selectedPatient.conditions.length} conditions |{" "}
                  {selectedPatient.medications.length} meds
                </div>
              </div>
            </div>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[380px] max-h-[320px] overflow-y-auto">
          {patients.map((patient) => (
            <DropdownMenuItem
              key={patient.patient_id}
              onClick={() => onSelect(patient.patient_id)}
              className="py-2"
            >
              <div className="flex items-center gap-3 w-full">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium shrink-0">
                  {patient.demographics.given?.[0]}
                  {patient.demographics.family?.[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{patient.demographics.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {patient.demographics.age}y | {patient.conditions.length} conditions |{" "}
                    {patient.active_alerts.length} alerts
                  </div>
                </div>
                <ProfileBadge profile={patient.profile_type} />
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Workbench summary                                                  */
/* ------------------------------------------------------------------ */

function EscalationHeroCard({
  patient,
  snapshots,
  thresholds,
  liveReading,
  recentAlerts,
  tickCount,
  selectedBaseline,
  currentStatus,
  baselineRiskDelta,
  baselineAlertDelta,
  clinicalSummary,
}: {
  patient: Patient360
  snapshots: LongitudinalSnapshot[]
  thresholds: ThresholdMap
  liveReading?: LiveReading
  recentAlerts: AlertNotification[]
  tickCount: number
  selectedBaseline: LongitudinalSnapshot | null
  currentStatus: WorkbenchStatus | null
  baselineRiskDelta: number | null
  baselineAlertDelta: number | null
  clinicalSummary: string | null
}) {
  const currentSnapshot = snapshots[snapshots.length - 1]
  const breaches = getThresholdBreaches(getCurrentVitals(patient, liveReading), thresholds)
  const escalationState = currentStatus ?? getEscalationState(patient, currentSnapshot, breaches, recentAlerts)
  const openCareGaps = patient.care_gaps.filter((gap) => gap.status === "open").length
  const statusContainerClassName =
    "containerClassName" in escalationState && typeof escalationState.containerClassName === "string"
      ? escalationState.containerClassName
      : getStatusContainerClassName(escalationState.tone)

  return (
    <Card className={cn("border-2", statusContainerClassName)}>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">
                {patient.demographics.name} is {escalationState.title.toLowerCase()}
              </CardTitle>
              <ProfileBadge profile={patient.profile_type} />
              <StatusBadge label={escalationState.title} tone={escalationState.tone} />
              {selectedBaseline && (
                <Badge variant="outline" className="text-xs">
                  vs {selectedBaseline.label}
                </Badge>
              )}
            </div>
            <CardDescription className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {clinicalSummary
                ? clinicalSummary
                : selectedBaseline
                  ? `${escalationState.description} Relative to ${selectedBaseline.label.toLowerCase()}, the current window shows a clinically meaningful shift in burden and trajectory.`
                  : escalationState.description}
            </CardDescription>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm md:min-w-[320px]">
            <WorkbenchMetric
              label="Current risk"
              value={String(currentSnapshot?.risk_score ?? "—")}
              helper={
                baselineRiskDelta === null || !selectedBaseline
                  ? "0-100 composite"
                  : (
                    <ComparisonHelper
                      delta={baselineRiskDelta}
                      comparisonLabel={selectedBaseline.label}
                      unitLabel="points"
                      lowerIsBetter
                    />
                  )
              }
            />
            <WorkbenchMetric
              label="Active alerts"
              value={String(patient.active_alerts.length)}
              helper={
                baselineAlertDelta === null || !selectedBaseline
                  ? `${patient.active_alerts.filter((alert) => alert.severity === "critical").length} critical`
                  : (
                    <ComparisonHelper
                      delta={baselineAlertDelta}
                      comparisonLabel={selectedBaseline.label}
                      unitLabel="alerts"
                      lowerIsBetter
                    />
                  )
              }
            />
            <WorkbenchMetric
              label="Threshold breaches"
              value={String(breaches.length)}
              helper={
                selectedBaseline
                  ? `${breaches.length} vitals currently outside personalized range`
                  : breaches.length > 0
                    ? "Personalized limits"
                    : "Within range"
              }
            />
            <WorkbenchMetric
              label="Open care gaps"
              value={String(openCareGaps)}
              helper={
                openCareGaps > 0
                  ? `${openCareGaps} unresolved follow-up item${openCareGaps === 1 ? "" : "s"}`
                  : (liveReading ? `Updated at tick ${tickCount}` : formatRelativeTime(patient.updated_at))
              }
            />
          </div>
        </div>
      </CardHeader>
    </Card>
  )
}

function WhyNowCard({
  patient,
  snapshots,
  thresholds,
  liveReading,
  recentAlerts,
  selectedBaseline,
  topRiskDrivers,
}: {
  patient: Patient360
  snapshots: LongitudinalSnapshot[]
  thresholds: ThresholdMap
  liveReading?: LiveReading
  recentAlerts: AlertNotification[]
  selectedBaseline: LongitudinalSnapshot | null
  topRiskDrivers: string[]
}) {
  const drivers = topRiskDrivers.length > 0
    ? topRiskDrivers
    : getWhyNowDrivers(
        patient,
        snapshots,
        thresholds,
        liveReading,
        recentAlerts,
        selectedBaseline,
      )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Why This Patient Needs Attention
        </CardTitle>
        <CardDescription>
          Signals currently pushing the patient toward escalation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {drivers.map((driver, index) => (
          <div key={index} className="flex items-start gap-3 rounded-lg border p-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              {index + 1}
            </span>
            <p className="text-sm leading-relaxed text-muted-foreground">{driver}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function RecommendedActionsCard({
  patient,
  actions,
}: {
  patient: Patient360
  actions: RecommendedAction[]
}) {
  const displayActions: Array<{ title: string; description: string; source?: string | null }> =
    actions.length > 0
      ? actions
      : getRecommendedActions(patient).map((action) => ({ ...action, source: null }))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-primary" />
          Next Best Actions
        </CardTitle>
        <CardDescription>
          Recommended follow-up based on active alerts and care gaps
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {displayActions.map((action, index) => (
          <div key={index} className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{action.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{action.description}</p>
              {action.source ? (
                <p className="text-[11px] text-muted-foreground">Source: {action.source}</p>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function CurrentSignalCard({
  patient,
  thresholds,
  liveReading,
  thresholdBreaches,
}: {
  patient: Patient360
  thresholds: ThresholdMap
  liveReading?: LiveReading
  thresholdBreaches: Array<{
    vital: string
    current_value: number | null
    threshold: number | null
    breached: boolean
    direction: string | null
  }>
}) {
  const currentVitals = getCurrentVitals(patient, liveReading)
  const breaches = new Set(
    thresholdBreaches.length > 0
      ? thresholdBreaches.filter((breach) => breach.breached).map((breach) => breach.vital as VitalKey)
      : getThresholdBreaches(currentVitals, thresholds).map((breach) => breach.vitalKey),
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Heart className="h-4 w-4 text-primary" />
          Current Bedside Picture
        </CardTitle>
        <CardDescription>
          Live vitals compared with the patient&apos;s recent 4-hour baseline
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {WORKBENCH_VITALS.map((vitalKey) => {
            const config = VITAL_CONFIG[vitalKey]
            const baseline = patient.vitals_summary.avg_4h[vitalKey]
            const currentValue = currentVitals[vitalKey]
            const delta = roundTo(currentValue - baseline, vitalKey === "temperature" ? 2 : 1)
            const isBreached = breaches.has(vitalKey)

            return (
              <div
                key={vitalKey}
                className={cn(
                  "rounded-lg border p-3",
                  isBreached && "border-destructive/30 bg-destructive/5",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{config.label}</span>
                  {isBreached && (
                    <Badge variant="outline" className="border-destructive/30 text-destructive">
                      breach
                    </Badge>
                  )}
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-lg font-semibold tabular-nums">
                      {formatVitalValue(vitalKey, currentValue)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {config.unit}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      4h avg {formatVitalValue(vitalKey, baseline)} {config.unit}
                    </div>
                  </div>
                  {delta !== 0 && (
                    <DeltaIndicator
                      value={delta}
                      invert={vitalKey !== "spo2"}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          {liveReading
            ? `Live vitals received ${formatRelativeTime(liveReading.timestamp)} and are being interpreted against personalized thresholds.`
            : "No active live packet for this patient, so the latest materialized vitals are being used."}
        </div>
        {thresholdBreaches.some((breach) => breach.breached) && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-muted-foreground">
            {thresholdBreaches
              .filter((breach) => breach.breached)
              .slice(0, 2)
              .map((breach) => {
                const label = VITAL_CONFIG[breach.vital as VitalKey]?.label ?? breach.vital
                return `${label} is ${breach.direction} threshold`
              })
              .join(" • ")}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BaselineComparisonCard({
  patient,
  baselineOptions,
  selectedBaseline,
  onSelectBaseline,
  thresholds,
  liveReading,
  baselineRiskDelta,
  baselineAlertDelta,
  baselineVitalDeltas,
  clinicalSummary,
}: {
  patient: Patient360
  baselineOptions: LongitudinalSnapshot[]
  selectedBaseline: LongitudinalSnapshot | null
  onSelectBaseline: (periodKey: string) => void
  thresholds: ThresholdMap
  liveReading?: LiveReading
  baselineRiskDelta: number | null
  baselineAlertDelta: number | null
  baselineVitalDeltas: BaselineVitalDelta[]
  clinicalSummary: string | null
}) {
  const currentVitals = getCurrentVitals(patient, liveReading)
  const currentBreaches = new Set(getThresholdBreaches(currentVitals, thresholds).map((breach) => breach.vitalKey))

  if (!selectedBaseline) return null

  const currentAlertTotal = patient.active_alerts.length
  const baselineAlertTotal = countAlerts(selectedBaseline.alert_frequency)
  const riskDelta =
    baselineRiskDelta ?? (patientRiskScore(patient) - selectedBaseline.risk_score)

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          Baseline Shift Review
        </CardTitle>
        <CardDescription>
          Compare today&apos;s physiology with this same patient&apos;s own historical windows.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {baselineOptions.map((snapshot) => (
            <Button
              key={snapshot.period_key}
              type="button"
              size="sm"
              variant={selectedBaseline.period_key === snapshot.period_key ? "default" : "outline"}
              className="h-8"
              onClick={() => onSelectBaseline(snapshot.period_key)}
            >
              {snapshot.label}
            </Button>
          ))}
        </div>

        <div className="rounded-lg border bg-background p-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {clinicalSummary ?? (
              <>
                Compared with <span className="font-semibold text-foreground">{selectedBaseline.label.toLowerCase()}</span>,
                {" "}
                {patient.demographics.name}&apos;s current risk score is{" "}
                <span className="font-semibold text-foreground">
                  {Math.abs(riskDelta)} points {riskDelta >= 0 ? "higher" : "lower"}
                </span>
                {" "}and the current window carries{" "}
                <span className="font-semibold text-foreground">
                  {Math.abs(currentAlertTotal - baselineAlertTotal)} {currentAlertTotal >= baselineAlertTotal ? "more" : "fewer"}
                </span>{" "}
                alerts than that baseline period.
              </>
            )}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(baselineVitalDeltas.length > 0 ? baselineVitalDeltas : WORKBENCH_VITALS.map((vitalKey) => ({
            vital: vitalKey,
            label: VITAL_CONFIG[vitalKey].label,
            unit: VITAL_CONFIG[vitalKey].unit,
            current_value: currentVitals[vitalKey],
            baseline_value: selectedBaseline.vitals_summary[vitalKey]?.avg ?? 0,
            delta: roundTo(currentVitals[vitalKey] - (selectedBaseline.vitals_summary[vitalKey]?.avg ?? 0), vitalKey === "temperature" ? 2 : 1),
            direction: currentVitals[vitalKey] >= (selectedBaseline.vitals_summary[vitalKey]?.avg ?? 0) ? "up" : "down",
            significance: "low" as const,
          }))).map((deltaItem) => (
            <HistoricalComparisonCell
              key={`${deltaItem.vital}-${selectedBaseline.period_key}`}
              label={deltaItem.label}
              baselineLabel={selectedBaseline.label}
              currentValue={deltaItem.current_value}
              historicalValue={deltaItem.baseline_value}
              unit={deltaItem.unit}
              breached={currentBreaches.has(deltaItem.vital as VitalKey)}
              invert={(deltaItem.vital as VitalKey) !== "spo2"}
              significance={deltaItem.significance}
            />
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <WorkbenchMetric
            label={`${selectedBaseline.label} risk`}
            value={String(selectedBaseline.risk_score)}
            helper={
              <ComparisonHelper
                delta={-riskDelta}
                comparisonLabel="current"
                unitLabel="points"
              />
            }
          />
          <WorkbenchMetric
            label={`${selectedBaseline.label} alerts`}
            value={String(baselineAlertTotal)}
            helper={
              baselineAlertDelta === null
                ? (
                  <ComparisonHelper
                    delta={baselineAlertTotal - currentAlertTotal}
                    comparisonLabel="current"
                    unitLabel="alerts"
                  />
                )
                : (
                  <ComparisonHelper
                    delta={-baselineAlertDelta}
                    comparisonLabel="current window"
                    unitLabel="alerts"
                  />
                )
            }
          />
          <WorkbenchMetric
            label="Threshold guardrails"
            value={`HR ${thresholds.heart_rate.high}`}
            helper={`SpO2 floor ${thresholds.spo2.low}% · RR ceiling ${thresholds.respiratory_rate.high}/min`}
          />
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Clinical trajectory summary                                        */
/* ------------------------------------------------------------------ */

function TrajectoryCard({
  snapshots,
  profileType,
  selectedBaseline,
}: {
  snapshots: LongitudinalSnapshot[]
  profileType: string
  selectedBaseline: LongitudinalSnapshot | null
}) {
  const trends = snapshots.map((s) => s.trend_vs_previous)
  const worseningCount = trends.filter((t) => t === "worsening").length
  const improvingCount = trends.filter((t) => t === "improving").length

  let overallLabel: string
  let overallColor: string
  let OverallIcon: React.ComponentType<{ className?: string }>

  if (worseningCount >= 3) {
    overallLabel = "Deteriorating over 6 months"
    overallColor = "text-destructive"
    OverallIcon = TrendingDown
  } else if (improvingCount >= 3) {
    overallLabel = "Improving over 6 months"
    overallColor = "text-emerald-500"
    OverallIcon = TrendingUp
  } else if (worseningCount > improvingCount) {
    overallLabel = "Gradual decline observed"
    overallColor = "text-orange-500"
    OverallIcon = TrendingDown
  } else if (improvingCount > worseningCount) {
    overallLabel = "Trending toward improvement"
    overallColor = "text-emerald-500"
    OverallIcon = TrendingUp
  } else {
    overallLabel = "Stable trajectory"
    overallColor = "text-muted-foreground"
    OverallIcon = Minus
  }

  const trendColor = (t: string) => {
    if (t === "worsening") return "bg-destructive"
    if (t === "improving") return "bg-emerald-500"
    return "bg-muted-foreground/40"
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          Clinical Trajectory
        </CardTitle>
        <CardDescription>
          Overall health direction based on longitudinal trend markers
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-4">
          <OverallIcon className={cn("h-5 w-5", overallColor)} />
          <span className={cn("text-lg font-semibold", overallColor)}>{overallLabel}</span>
          <ProfileBadge profile={profileType} />
        </div>
        <div className="flex items-center gap-2">
          {snapshots.map((s, i) => (
            <React.Fragment key={s.period_key}>
              <div className="flex flex-col items-center gap-1 flex-1">
                <div className="relative">
                  <div
                    className={cn(
                      "h-3 w-3 rounded-full ring-offset-2",
                      trendColor(s.trend_vs_previous),
                      selectedBaseline?.period_key === s.period_key && "ring-2 ring-primary",
                    )}
                  />
                  {s.source === "live" && (
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-background bg-emerald-500" />
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground text-center leading-tight">
                  {s.label}
                </span>
                {selectedBaseline?.period_key === s.period_key && (
                  <span className="text-[9px] font-medium uppercase tracking-wide text-primary">
                    baseline
                  </span>
                )}
              </div>
              {i < snapshots.length - 1 && (
                <div className="h-px flex-1 bg-border max-w-8" />
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="flex gap-4 mt-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Improving
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/40" /> Stable
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-destructive" /> Worsening
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Risk score area chart                                              */
/* ------------------------------------------------------------------ */

function RiskScoreChart({
  snapshots,
  selectedBaseline,
}: {
  snapshots: LongitudinalSnapshot[]
  selectedBaseline: LongitudinalSnapshot | null
}) {
  const data = snapshots.map((s) => ({
    label: s.label,
    risk: s.risk_score,
    source: s.source,
    period_key: s.period_key,
  }))

  const maxRisk = Math.max(...data.map((d) => d.risk))
  const riskColor = maxRisk >= 60 ? "hsl(0, 72%, 51%)" : maxRisk >= 35 ? "hsl(25, 95%, 53%)" : "hsl(160, 60%, 45%)"

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Risk Score Trend</CardTitle>
        <CardDescription>
          Composite risk score (0&ndash;100) over time
          {selectedBaseline ? ` with ${selectedBaseline.label.toLowerCase()} highlighted as the active baseline` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={riskColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={riskColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              {selectedBaseline && (
                <ReferenceLine
                  x={selectedBaseline.label}
                  stroke="hsl(var(--primary))"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
              )}
              <XAxis
                dataKey="label"
                stroke="var(--muted-foreground)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)" }}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
                tick={{ fill: "var(--muted-foreground)" }}
              />
              <Tooltip
                content={({ active, payload, label: tLabel }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="rounded-lg border bg-popover p-3 shadow-md text-sm">
                      <p className="text-xs text-muted-foreground mb-1">{tLabel}</p>
                      <p className="font-semibold tabular-nums">
                        Risk Score: {payload[0].value}
                      </p>
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="risk"
                stroke={riskColor}
                strokeWidth={2}
                fill="url(#riskGrad)"
                dot={(props: Record<string, unknown>) => {
                  const { cx, cy, index } = props as { cx: number; cy: number; index: number }
                  const isLive = data[index]?.source === "live"
                  const isBaseline = data[index]?.period_key === selectedBaseline?.period_key
                  return (
                    <circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={isBaseline ? 6 : isLive ? 5 : 4}
                      fill={isLive ? "hsl(160, 60%, 45%)" : isBaseline ? "hsl(var(--primary))" : riskColor}
                      stroke="var(--background)"
                      strokeWidth={isBaseline ? 3 : 2}
                    />
                  )
                }}
                activeDot={{ r: 6 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Individual vital trend chart                                       */
/* ------------------------------------------------------------------ */

function VitalTrendChart({
  vitalKey,
  snapshots,
  threshold,
  selectedBaseline,
}: {
  vitalKey: VitalKey
  snapshots: LongitudinalSnapshot[]
  threshold?: { low: number; high: number; source_rule: string | null }
  selectedBaseline: LongitudinalSnapshot | null
}) {
  const cfg = VITAL_CONFIG[vitalKey]

  const data = snapshots.map((s) => {
    const vs = s.vitals_summary[vitalKey]
    return {
      label: s.label,
      avg: vs?.avg ?? 0,
      min: vs?.min ?? 0,
      max: vs?.max ?? 0,
      source: s.source,
      period_key: s.period_key,
    }
  })

  const allValues = data.flatMap((d) => [d.min, d.max])
  const thresholdValues = threshold ? [threshold.low, threshold.high] : []
  const allBounds = [...allValues, ...thresholdValues]
  const domainMin = Math.min(...allBounds)
  const domainMax = Math.max(...allBounds)
  const pad = (domainMax - domainMin) * 0.15
  const domain: [number, number] = [
    Math.floor(domainMin - pad),
    Math.ceil(domainMax + pad),
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <cfg.icon className="h-3.5 w-3.5" />
          {cfg.label}
          <span className="text-xs text-muted-foreground font-normal ml-1">({cfg.unit})</span>
        </CardTitle>
        {selectedBaseline && (
          <CardDescription>
            Active baseline: {selectedBaseline.label}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id={`band-${vitalKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={cfg.color} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={cfg.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              {selectedBaseline && (
                <ReferenceLine
                  x={selectedBaseline.label}
                  stroke="hsl(var(--primary))"
                  strokeDasharray="4 4"
                  strokeOpacity={0.45}
                />
              )}
              <XAxis
                dataKey="label"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                stroke="var(--muted-foreground)"
                tick={{ fill: "var(--muted-foreground)" }}
              />
              <YAxis
                fontSize={10}
                tickLine={false}
                axisLine={false}
                domain={domain}
                stroke="var(--muted-foreground)"
                tick={{ fill: "var(--muted-foreground)" }}
              />
              <Tooltip
                content={({ active, payload, label: tLabel }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div className="rounded-lg border bg-popover p-3 shadow-md text-sm">
                      <p className="text-xs text-muted-foreground mb-1">{tLabel}</p>
                      <div className="space-y-0.5 tabular-nums">
                        <p>Avg: <span className="font-semibold">{d.avg}</span> {cfg.unit}</p>
                        <p className="text-xs text-muted-foreground">
                          Range: {d.min} &ndash; {d.max}
                        </p>
                      </div>
                    </div>
                  )
                }}
              />
              {/* Min–max band */}
              <Area
                type="monotone"
                dataKey="max"
                stroke="none"
                fill={`url(#band-${vitalKey})`}
              />
              <Area
                type="monotone"
                dataKey="min"
                stroke="none"
                fill="var(--background)"
              />
              {/* Average line */}
              <Line
                type="monotone"
                dataKey="avg"
                stroke={cfg.color}
                strokeWidth={2}
                dot={(props: Record<string, unknown>) => {
                  const { cx, cy, index } = props as { cx: number; cy: number; index: number }
                  const isLive = data[index]?.source === "live"
                  const isBaseline = data[index]?.period_key === selectedBaseline?.period_key
                  return (
                    <circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={isBaseline ? 5 : isLive ? 4 : 3}
                      fill={isLive ? "hsl(160, 60%, 45%)" : isBaseline ? "hsl(var(--primary))" : cfg.color}
                      stroke="var(--background)"
                      strokeWidth={isBaseline ? 3 : 2}
                    />
                  )
                }}
                activeDot={{ r: 5 }}
              />
              {/* Threshold reference lines */}
              {threshold && (
                <>
                  <ReferenceLine
                    y={threshold.high}
                    stroke="var(--destructive)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                  />
                  <ReferenceLine
                    y={threshold.low}
                    stroke="var(--destructive)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.3}
                  />
                </>
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {threshold && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Threshold: {threshold.low}&ndash;{threshold.high} {cfg.unit}
            {threshold.source_rule && " (personalized)"}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Period comparison cards                                            */
/* ------------------------------------------------------------------ */

function PeriodCards({
  snapshots,
  selectedBaseline,
}: {
  snapshots: LongitudinalSnapshot[]
  selectedBaseline: LongitudinalSnapshot | null
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Period-by-Period Comparison</CardTitle>
        <CardDescription>
          Key metrics across each time window with delta indicators
          {selectedBaseline ? `, with ${selectedBaseline.label.toLowerCase()} highlighted` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {snapshots.map((snap, i) => {
            const isLive = snap.source === "live"
            const prev = i > 0 ? snapshots[i - 1] : null
            const riskDelta = prev ? snap.risk_score - prev.risk_score : 0
            const totalAlerts =
              snap.alert_frequency.critical +
              snap.alert_frequency.high +
              snap.alert_frequency.moderate +
              snap.alert_frequency.low

            return (
              <div
                key={snap.period_key}
                className={cn(
                  "rounded-lg border p-3 space-y-2",
                  isLive && "border-l-2 border-l-emerald-500 bg-emerald-500/5",
                  selectedBaseline?.period_key === snap.period_key && "border-primary bg-primary/5 shadow-sm",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    {snap.label}
                    {selectedBaseline?.period_key === snap.period_key && (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                        Baseline
                      </span>
                    )}
                    {isLive && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Live
                      </span>
                    )}
                  </span>
                  <TrendBadge trend={snap.trend_vs_previous} />
                </div>

                {/* Risk score */}
                <div>
                  <div className="text-xs text-muted-foreground">Risk</div>
                  <div className="flex items-center gap-1">
                    <span className="text-lg font-bold tabular-nums">{snap.risk_score}</span>
                    {prev && riskDelta !== 0 && (
                      <DeltaIndicator value={riskDelta} invert />
                    )}
                  </div>
                </div>

                {/* Vitals averages */}
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">HR</span>
                    <span className="tabular-nums font-medium">
                      {snap.vitals_summary.heart_rate?.avg ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SpO2</span>
                    <span className="tabular-nums font-medium">
                      {snap.vitals_summary.spo2?.avg ?? "—"}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">RR</span>
                    <span className="tabular-nums font-medium">
                      {snap.vitals_summary.respiratory_rate?.avg ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Temp</span>
                    <span className="tabular-nums font-medium">
                      {snap.vitals_summary.temperature?.avg ?? "—"}°
                    </span>
                  </div>
                </div>

                {/* Alerts */}
                <div>
                  <div className="text-xs text-muted-foreground">Alerts</div>
                  <div className="text-sm font-semibold tabular-nums">{totalAlerts}</div>
                  {snap.alert_frequency.critical > 0 && (
                    <span className="text-[10px] text-destructive">
                      {snap.alert_frequency.critical} critical
                    </span>
                  )}
                </div>

                {isLive && snap.readings_analyzed > 0 && (
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {snap.readings_analyzed.toLocaleString()} readings
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Alert history stacked bar chart                                    */
/* ------------------------------------------------------------------ */

function AlertHistoryChart({ snapshots }: { snapshots: LongitudinalSnapshot[] }) {
  const data = snapshots.map((s) => ({
    label: s.label,
    critical: s.alert_frequency.critical,
    high: s.alert_frequency.high,
    moderate: s.alert_frequency.moderate,
    low: s.alert_frequency.low,
  }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Alert History
        </CardTitle>
        <CardDescription>
          Alert frequency by severity across each period
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                stroke="var(--muted-foreground)"
                tick={{ fill: "var(--muted-foreground)" }}
              />
              <YAxis
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                stroke="var(--muted-foreground)"
                tick={{ fill: "var(--muted-foreground)" }}
              />
              <Tooltip
                content={({ active, payload, label: tLabel }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="rounded-lg border bg-popover p-3 shadow-md text-sm">
                      <p className="text-xs text-muted-foreground mb-1.5">{tLabel}</p>
                      {payload.map((entry) => (
                        <div key={entry.dataKey as string} className="flex items-center gap-2 text-xs">
                          <span
                            className="inline-block h-2 w-2 rounded-sm"
                            style={{ background: entry.color }}
                          />
                          <span className="capitalize text-muted-foreground">{entry.dataKey as string}:</span>
                          <span className="font-semibold tabular-nums">{entry.value}</span>
                        </div>
                      ))}
                    </div>
                  )
                }}
              />
              <Bar dataKey="critical" stackId="alerts" fill={SEVERITY_COLORS.critical} radius={[0, 0, 0, 0]} />
              <Bar dataKey="high" stackId="alerts" fill={SEVERITY_COLORS.high} />
              <Bar dataKey="moderate" stackId="alerts" fill={SEVERITY_COLORS.moderate} />
              <Bar dataKey="low" stackId="alerts" fill={SEVERITY_COLORS.low} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-4 mt-2 text-[10px] text-muted-foreground">
          {(["critical", "high", "moderate", "low"] as const).map((sev) => (
            <span key={sev} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: SEVERITY_COLORS[sev] }}
              />
              <span className="capitalize">{sev}</span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Clinical context narrative                                         */
/* ------------------------------------------------------------------ */

function ClinicalContextCard({
  snapshots,
  profileType,
}: {
  snapshots: LongitudinalSnapshot[]
  profileType: string
}) {
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  if (!first || !last) return null

  const riskDelta = last.risk_score - first.risk_score
  const hrFirst = first.vitals_summary.heart_rate?.avg ?? 0
  const hrLast = last.vitals_summary.heart_rate?.avg ?? 0
  const spo2First = first.vitals_summary.spo2?.avg ?? 0
  const spo2Last = last.vitals_summary.spo2?.avg ?? 0

  const totalAlertsFirst =
    first.alert_frequency.critical + first.alert_frequency.high +
    first.alert_frequency.moderate + first.alert_frequency.low
  const totalAlertsLast =
    last.alert_frequency.critical + last.alert_frequency.high +
    last.alert_frequency.moderate + last.alert_frequency.low

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          Clinical Insights
        </CardTitle>
        <CardDescription>
          Key observations from the longitudinal analysis
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <InsightItem
            icon={Shield}
            title="Risk Progression"
            description={
              riskDelta > 10
                ? `Risk score increased by ${riskDelta} points over 6 months (${first.risk_score} → ${last.risk_score}), indicating significant clinical deterioration requiring intervention.`
                : riskDelta < -5
                  ? `Risk score improved by ${Math.abs(riskDelta)} points (${first.risk_score} → ${last.risk_score}), suggesting treatment effectiveness.`
                  : `Risk score remained relatively stable (${first.risk_score} → ${last.risk_score}), consistent with maintained clinical status.`
            }
          />
          <InsightItem
            icon={Heart}
            title="Heart Rate Trend"
            description={
              hrLast - hrFirst > 5
                ? `Average HR increased from ${hrFirst} to ${hrLast} bpm, a ${((hrLast - hrFirst) / hrFirst * 100).toFixed(0)}% rise that may indicate cardiovascular stress or medication changes.`
                : `Average HR stable around ${hrLast} bpm across the observation period.`
            }
          />
          <InsightItem
            icon={ActivityIcon}
            title="Oxygenation Status"
            description={
              spo2First - spo2Last > 1.5
                ? `SpO2 declined from ${spo2First}% to ${spo2Last}%, a clinically meaningful drop warranting respiratory assessment.`
                : `SpO2 maintained at ${spo2Last}%, within acceptable range for this patient's profile.`
            }
          />
          <InsightItem
            icon={AlertTriangle}
            title="Alert Escalation"
            description={
              totalAlertsLast > totalAlertsFirst * 2
                ? `Alert frequency escalated from ${totalAlertsFirst} to ${totalAlertsLast} per period, with ${last.alert_frequency.critical} critical alerts in the current window.`
                : `Alert frequency ${totalAlertsLast <= totalAlertsFirst ? "remained stable or decreased" : "slightly increased"} across the observation period.`
            }
          />
        </div>

        {/* Period notes timeline */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-3">Clinical Notes Timeline</h4>
          <div className="space-y-2">
            {snapshots.map((s) => (
              <div key={s.period_key} className="flex gap-3 text-sm">
                <span className="text-xs text-muted-foreground w-24 shrink-0 pt-0.5 flex items-center gap-1">
                  {s.label}
                  {s.source === "live" && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  )}
                </span>
                <div className="flex items-start gap-2">
                  <div
                    className={cn(
                      "mt-1.5 h-2 w-2 rounded-full shrink-0",
                      s.trend_vs_previous === "worsening" && "bg-destructive",
                      s.trend_vs_previous === "improving" && "bg-emerald-500",
                      s.trend_vs_previous === "stable" && "bg-muted-foreground/40",
                    )}
                  />
                  <span className="text-muted-foreground">{s.notes}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function InsightItem({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border bg-background p-3">
      <Icon className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground leading-relaxed">{description}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Pipeline showcase                                                  */
/* ------------------------------------------------------------------ */

function PipelineShowcase({
  pipelineDisplay,
  aggregationMs,
  readingsAnalyzed,
}: {
  pipelineDisplay: string
  aggregationMs: number | null
  readingsAnalyzed: number
}) {
  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5">
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Database className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          Real-Time Aggregation Pipeline
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live
          </span>
        </CardTitle>
        <CardDescription>
          This single MongoDB aggregation pipeline computes statistics across all vitals in one pass
          over the time-series data &mdash; no pre-computation, no ETL, no batch jobs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {aggregationMs !== null && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-500/15 px-3 py-2">
              <Zap className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                {aggregationMs}ms
              </span>
              <span className="text-xs text-muted-foreground">
                aggregation time
              </span>
            </div>
          )}
          {readingsAnalyzed > 0 && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-500/15 px-3 py-2">
              <ActivityIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                {readingsAnalyzed.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">
                readings analyzed
              </span>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-background p-4">
          <pre className="overflow-x-auto text-xs font-mono leading-relaxed text-muted-foreground">
            <code>{pipelineDisplay}</code>
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Why MongoDB                                                        */
/* ------------------------------------------------------------------ */

function WhyMongoDB({
  loadMs,
  aggregationMs,
  patientCount,
  liveSnapshots,
}: {
  loadMs: number | null
  aggregationMs: number | null
  patientCount: number
  liveSnapshots: LongitudinalSnapshot[]
}) {
  const totalLiveReadings = liveSnapshots.reduce((sum, s) => sum + s.readings_analyzed, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Database className="h-5 w-5 text-[#00684A]" />
          Technical Deep Dive: Why MongoDB
        </CardTitle>
        <CardDescription>
          How MongoDB Atlas powers the hybrid longitudinal analysis you just saw
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#00684A]" />
              <span className="font-medium text-sm">Hybrid Architecture</span>
            </div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              Historical baselines are embedded in the Patient 360 document
              (one read). Live windows are computed on-the-fly from the
              synthetic_vitals time-series via <code className="text-xs">$group</code> aggregation.
            </div>
            {loadMs !== null && (
              <div className="flex items-center gap-2 rounded-md bg-[#00684A]/10 px-3 py-2">
                <Clock className="h-3.5 w-3.5 text-[#00684A]" />
                <span className="text-sm font-mono font-semibold text-[#00684A]">
                  {loadMs}ms
                </span>
                <span className="text-xs text-muted-foreground">
                  total response time
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#00684A]" />
              <span className="font-medium text-sm">Aggregation Pipeline</span>
            </div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              A single <code className="text-xs">$match → $group</code> pipeline
              computes avg, min, max, and stddev for four vital signs in one pass.
              No ETL, no pre-computation, no batch jobs.
            </div>
            {aggregationMs !== null && (
              <div className="flex items-center gap-2 rounded-md bg-[#00684A]/10 px-3 py-2">
                <Zap className="h-3.5 w-3.5 text-[#00684A]" />
                <span className="text-sm font-mono font-semibold text-[#00684A]">
                  {aggregationMs}ms
                </span>
                <span className="text-xs text-muted-foreground">
                  to aggregate {totalLiveReadings.toLocaleString()} readings
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#00684A]" />
              <span className="font-medium text-sm">Schema Flexibility</span>
            </div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              Adding the hybrid approach required zero schema migrations.
              Embedded historical snapshots + time-series aggregation
              coexist in one query &mdash; no ALTER TABLE, no versioning friction.
            </div>
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {patientCount} Patient 360 documents with hybrid trends
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

function ProfileBadge({ profile }: { profile: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    target: { label: "High Risk", className: "bg-destructive/10 text-destructive border-destructive/20" },
    diabetic: { label: "Diabetic", className: "bg-warning/10 text-warning border-warning/20" },
    cardiac: { label: "Cardiac", className: "bg-chart-1/10 text-chart-1 border-chart-1/20" },
    healthy: { label: "Healthy", className: "bg-success/10 text-success border-success/20" },
  }
  const v = variants[profile] || { label: profile, className: "" }
  return (
    <Badge variant="outline" className={cn("text-xs", v.className)}>
      {v.label}
    </Badge>
  )
}

function TrendBadge({ trend }: { trend: string }) {
  if (trend === "worsening") {
    return (
      <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive gap-0.5 px-1.5">
        <ArrowUp className="h-2.5 w-2.5" />
        Worse
      </Badge>
    )
  }
  if (trend === "improving") {
    return (
      <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-500 gap-0.5 px-1.5">
        <ArrowDown className="h-2.5 w-2.5" />
        Better
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-[10px] gap-0.5 px-1.5">
      <Minus className="h-2.5 w-2.5" />
      Stable
    </Badge>
  )
}

function DeltaIndicator({ value, invert = false }: { value: number; invert?: boolean }) {
  const isUp = value > 0
  const isNegative = invert ? isUp : !isUp

  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-medium tabular-nums",
        isNegative ? "text-destructive" : "text-emerald-500",
      )}
    >
      {isUp ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(value)}
    </span>
  )
}

function StatusBadge({
  label,
  tone,
}: {
  label: string
  tone: "critical" | "high" | "moderate" | "stable"
}) {
  const className =
    tone === "critical"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "high"
        ? "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400"
        : tone === "moderate"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"

  return (
    <Badge variant="outline" className={cn("text-xs", className)}>
      {label}
    </Badge>
  )
}

function getStatusContainerClassName(tone: "critical" | "high" | "moderate" | "stable") {
  if (tone === "critical") return "border-destructive/30 bg-destructive/5"
  if (tone === "high") return "border-orange-500/30 bg-orange-500/5"
  if (tone === "moderate") return "border-amber-500/30 bg-amber-500/5"
  return "border-emerald-500/30 bg-emerald-500/5"
}

function WorkbenchMetric({
  label,
  value,
  helper,
}: {
  label: string
  value: string
  helper: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{helper}</div>
    </div>
  )
}

function ComparisonHelper({
  delta,
  comparisonLabel,
  unitLabel,
  lowerIsBetter = false,
}: {
  delta: number | null
  comparisonLabel: string | null
  unitLabel: string
  lowerIsBetter?: boolean
}) {
  if (delta === null || !comparisonLabel || delta === 0) {
    return <span>Unchanged from {comparisonLabel ?? "baseline"}</span>
  }

  const isHigher = delta > 0
  const positiveTone = lowerIsBetter ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
  const negativeTone = lowerIsBetter ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
  const tone = isHigher ? positiveTone : negativeTone

  return (
    <span className={cn("inline-flex items-center gap-1", tone)}>
      {isHigher ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      <span className="font-medium">
        {Math.abs(delta)} {unitLabel} {isHigher ? "higher" : "lower"}
      </span>
      <span className="text-muted-foreground">than {comparisonLabel}</span>
    </span>
  )
}

function HistoricalComparisonCell({
  label,
  baselineLabel,
  currentValue,
  historicalValue,
  unit,
  breached,
  invert,
  significance = "low",
}: {
  label: string
  baselineLabel: string
  currentValue: number
  historicalValue: number | null
  unit: string
  breached: boolean
  invert: boolean
  significance?: "high" | "moderate" | "low"
}) {
  const delta = historicalValue === null ? null : roundTo(currentValue - historicalValue, unit === "°C" ? 2 : 1)

  return (
    <div className={cn("rounded-md border p-3", breached && "border-destructive/30 bg-destructive/5")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-[11px] text-muted-foreground">{baselineLabel} average</div>
        </div>
        <div className="flex gap-1">
          {significance !== "low" && (
            <Badge
              variant="outline"
              className={cn(
                significance === "high"
                  ? "border-orange-500/30 text-orange-600 dark:text-orange-400"
                  : "border-amber-500/30 text-amber-600 dark:text-amber-400",
              )}
            >
              {significance}
            </Badge>
          )}
          {breached && (
            <Badge variant="outline" className="border-destructive/30 text-destructive">
              breach
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-lg font-semibold tabular-nums">
            {currentValue.toFixed(unit === "°C" ? 1 : 0)} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {historicalValue === null ? "No baseline" : `${historicalValue.toFixed(unit === "°C" ? 1 : 0)} ${unit}`}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1">
            {delta !== null ? <DeltaIndicator value={delta} invert={invert} /> : null}
          </div>
          <div className={cn("mt-1 text-[11px] font-medium", breached ? "text-destructive" : "text-muted-foreground")}>
            {delta === null ? "not available" : delta === 0 ? "unchanged" : "vs selected baseline"}
          </div>
        </div>
      </div>
    </div>
  )
}

function getCurrentVitals(
  patient: Patient360,
  liveReading?: LiveReading,
): Pick<Patient360["vitals_summary"]["latest"], VitalKey | "timestamp"> {
  if (liveReading) {
    return {
      timestamp: liveReading.timestamp,
      heart_rate: liveReading.heart_rate,
      spo2: liveReading.spo2,
      respiratory_rate: liveReading.respiratory_rate,
      temperature: liveReading.temperature,
    }
  }

  return patient.vitals_summary.latest
}

function getThresholdBreaches(
  currentVitals: Pick<Patient360["vitals_summary"]["latest"], VitalKey | "timestamp">,
  thresholds: ThresholdMap | Patient360["personalized_thresholds"],
): ThresholdBreach[] {
  const breaches: ThresholdBreach[] = []

  for (const vitalKey of WORKBENCH_VITALS) {
    const threshold = thresholds[vitalKey]
    const value = currentVitals[vitalKey]
    if (value > threshold.high) {
      breaches.push({
        vitalKey,
        label: VITAL_CONFIG[vitalKey].label,
        value,
        threshold: threshold.high,
        direction: "high",
        delta: roundTo(value - threshold.high, vitalKey === "temperature" ? 2 : 1),
      })
    } else if (value < threshold.low) {
      breaches.push({
        vitalKey,
        label: VITAL_CONFIG[vitalKey].label,
        value,
        threshold: threshold.low,
        direction: "low",
        delta: roundTo(threshold.low - value, vitalKey === "temperature" ? 2 : 1),
      })
    }
  }

  return breaches
}

function getEscalationState(
  patient: Patient360,
  currentSnapshot: LongitudinalSnapshot | undefined,
  breaches: ThresholdBreach[],
  recentAlerts: AlertNotification[],
) {
  const criticalAlerts = patient.active_alerts.filter((alert) => alert.severity === "critical").length
  const highAlerts = patient.active_alerts.filter((alert) => alert.severity === "high").length
  const recentCritical = recentAlerts.some((alert) => alert.severity === "critical")
  const riskScore = currentSnapshot?.risk_score ?? 0

  if (criticalAlerts > 0 || recentCritical || breaches.length >= 3 || riskScore >= 70) {
    return {
      title: "Critical Escalation",
      tone: "critical" as const,
      containerClassName: "border-destructive/30 bg-destructive/5",
      description:
        "Multiple signals now suggest active deterioration. This patient should move from passive monitoring into immediate clinical review.",
    }
  }

  if (highAlerts > 0 || breaches.length >= 2 || riskScore >= 55) {
    return {
      title: "Escalating Risk",
      tone: "high" as const,
      containerClassName: "border-orange-500/30 bg-orange-500/5",
      description:
        "The patient is drifting away from personalized baseline and should be reviewed before the current pattern hardens into a critical event.",
    }
  }

  if (patient.care_gaps.some((gap) => gap.status === "open") || riskScore >= 35) {
    return {
      title: "Watch Closely",
      tone: "moderate" as const,
      containerClassName: "border-amber-500/30 bg-amber-500/5",
      description:
        "No immediate crisis is evident, but this patient has enough context and mild signal drift to justify closer follow-up.",
    }
  }

  return {
    title: "Stable For Now",
    tone: "stable" as const,
    containerClassName: "border-emerald-500/30 bg-emerald-500/5",
    description:
      "Current signals remain within expected range for this patient, with no immediate need to escalate beyond routine monitoring.",
  }
}

function getWhyNowDrivers(
  patient: Patient360,
  snapshots: LongitudinalSnapshot[],
  thresholds: ThresholdMap,
  liveReading: LiveReading | undefined,
  recentAlerts: AlertNotification[],
  selectedBaseline: LongitudinalSnapshot | null,
) {
  const currentSnapshot = snapshots[snapshots.length - 1]
  const previousSnapshot = snapshots[snapshots.length - 2]
  const currentVitals = getCurrentVitals(patient, liveReading)
  const breaches = getThresholdBreaches(currentVitals, thresholds)
  const drivers: string[] = []

  for (const breach of breaches.slice(0, 2)) {
    drivers.push(
      `${breach.label} is ${formatVitalValue(breach.vitalKey, breach.value)} ${VITAL_CONFIG[breach.vitalKey].unit}, ${breach.delta} ${VITAL_CONFIG[breach.vitalKey].unit} ${breach.direction === "high" ? "above" : "below"} the personalized ${breach.direction === "high" ? "ceiling" : "floor"}.`,
    )
  }

  if (
    previousSnapshot &&
    currentSnapshot &&
    currentSnapshot.risk_score - previousSnapshot.risk_score >= 10
  ) {
    drivers.push(
      `Risk score climbed from ${previousSnapshot.risk_score} in the prior window to ${currentSnapshot.risk_score} now, suggesting acceleration rather than isolated noise.`,
    )
  }

  if (selectedBaseline) {
    const baselineComparisons = getBaselineDeltaNarratives(currentVitals, selectedBaseline)
    drivers.push(...baselineComparisons)

    const baselineRiskDelta = patientRiskScore(patient) - selectedBaseline.risk_score
    if (Math.abs(baselineRiskDelta) >= 8) {
      drivers.push(
        `Compared with ${selectedBaseline.label.toLowerCase()}, the patient-wide risk picture is ${Math.abs(baselineRiskDelta)} points ${baselineRiskDelta >= 0 ? "higher" : "lower"}, supporting a meaningful change in status rather than a single noisy reading.`,
      )
    }
  }

  const spo2Trend = patient.vitals_summary.trend_24h.spo2
  const rrTrend = patient.vitals_summary.trend_24h.respiratory_rate
  if (spo2Trend === "decreasing" || rrTrend === "increasing") {
    drivers.push(
      `The 24-hour physiologic trend is concerning: oxygenation is ${spo2Trend} while respiratory rate is ${rrTrend}, which fits early decompensation rather than a transient blip.`,
    )
  }

  if (recentAlerts[0]) {
    drivers.push(
      `A new ${recentAlerts[0].severity} alert fired ${formatRelativeTime(recentAlerts[0].timestamp)}: ${recentAlerts[0].title}.`,
    )
  } else if (patient.active_alerts[0]) {
    drivers.push(
      `The active alert stack is already elevated, led by "${patient.active_alerts[0].title}" with reasoning tied to this patient’s medication and comorbidity profile.`,
    )
  }

  if (patient.flags.has_beta_blocker || patient.flags.has_ckd || patient.flags.has_insulin) {
    const contextBits = [
      patient.flags.has_beta_blocker ? "beta-blocker therapy lowers expected HR baseline" : null,
      patient.flags.has_ckd ? "CKD makes oxygenation and respiratory changes more clinically meaningful" : null,
      patient.flags.has_insulin ? "insulin raises concern for hypoglycemic physiology" : null,
    ].filter(Boolean)
    drivers.push(`Clinical context matters here because ${contextBits.join("; ")}.`)
  }

  return drivers.slice(0, 4)
}

function getRecommendedActions(patient: Patient360) {
  const actions: Array<{ title: string; description: string }> = []
  const seen = new Set<string>()

  for (const alert of patient.active_alerts) {
    for (const suggested of alert.suggested_actions) {
      const key = suggested.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      actions.push({
        title: suggested,
        description: `Recommended by ${alert.title.toLowerCase()} based on the patient's current context and alert reasoning.`,
      })
    }
  }

  for (const gap of patient.care_gaps.filter((item) => item.status === "open")) {
    const key = `gap-${gap.hedis_measure}`
    if (seen.has(key)) continue
    seen.add(key)
    actions.push({
      title: gap.measure_name,
      description: gap.days_overdue > 0
        ? `${gap.days_overdue} days overdue. Closing this gap strengthens chronic disease follow-up and reduces risk of missed deterioration.`
        : `Due by ${gap.due_by}. Scheduling it now makes the RPM workflow feel clinically actionable, not purely observational.`,
    })
  }

  if (actions.length === 0) {
    actions.push({
      title: "Continue routine monitoring",
      description:
        "No urgent interventions are currently inferred, so the next step is to keep the patient on normal surveillance and review the next live window.",
    })
  }

  return actions.slice(0, 4)
}

function getHistoricalBaselineSnapshots(snapshots: LongitudinalSnapshot[]) {
  const preferredPeriods = ["1 Week", "1 Month", "3 Months", "6 Months"]
  const sourceSnapshots = snapshots.filter((snapshot) => snapshot.source !== "live")
  const preferredMatches = preferredPeriods
    .map((label) => sourceSnapshots.find((snapshot) => snapshot.label === label))
    .filter((snapshot): snapshot is LongitudinalSnapshot => Boolean(snapshot))

  return preferredMatches.length > 0 ? preferredMatches : sourceSnapshots.slice().reverse()
}

function getBaselineDeltaNarratives(
  currentVitals: Pick<Patient360["vitals_summary"]["latest"], VitalKey | "timestamp">,
  baseline: LongitudinalSnapshot,
) {
  const candidates = (["heart_rate", "spo2", "respiratory_rate", "temperature"] as VitalKey[])
    .map((vitalKey) => {
      const historicalValue = baseline.vitals_summary[vitalKey]?.avg
      if (historicalValue == null) return null

      const currentValue = currentVitals[vitalKey]
      const delta = roundTo(currentValue - historicalValue, vitalKey === "temperature" ? 2 : 1)
      return {
        vitalKey,
        currentValue,
        historicalValue,
        absoluteDelta: Math.abs(delta),
        narrative: `Compared with ${baseline.label.toLowerCase()}, ${VITAL_CONFIG[vitalKey].label.toLowerCase()} is ${delta > 0 ? "+" : ""}${delta} ${VITAL_CONFIG[vitalKey].unit} (${formatVitalValue(vitalKey, historicalValue)} -> ${formatVitalValue(vitalKey, currentValue)}), which strengthens the case that this is true physiologic drift.`,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b?.absoluteDelta ?? 0) - (a?.absoluteDelta ?? 0))

  return candidates.slice(0, 2).map((candidate) => candidate!.narrative)
}

function patientRiskScore(patient: Patient360) {
  let score = patient.active_alerts.length * 12
  score += patient.care_gaps.filter((gap) => gap.status === "open").length * 6

  if (patient.vitals_summary.trend_24h.heart_rate === "increasing") score += 8
  if (patient.vitals_summary.trend_24h.respiratory_rate === "increasing") score += 10
  if (patient.vitals_summary.trend_24h.spo2 === "decreasing") score += 12
  if (patient.flags.has_ckd) score += 6
  if (patient.flags.has_insulin) score += 6
  if (patient.flags.has_beta_blocker) score += 4

  return Math.min(100, score)
}

function countAlerts(alertFrequency: LongitudinalSnapshot["alert_frequency"]) {
  return (
    alertFrequency.critical +
    alertFrequency.high +
    alertFrequency.moderate +
    alertFrequency.low
  )
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function formatVitalValue(vitalKey: VitalKey, value: number) {
  return vitalKey === "temperature" ? value.toFixed(1) : value.toFixed(0)
}

function formatRelativeTime(timestamp: string) {
  const diffMs = Date.now() - new Date(timestamp).getTime()
  if (Number.isNaN(diffMs)) return "recently"

  const diffMinutes = Math.max(1, Math.round(diffMs / 60000))
  if (diffMinutes < 60) return `${diffMinutes} min ago`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} hr ago`

  const diffDays = Math.round(diffHours / 24)
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`
}
