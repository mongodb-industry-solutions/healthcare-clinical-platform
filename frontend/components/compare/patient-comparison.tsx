"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  Heart,
  Info,
  Loader2,
  Pill,
  Shield,
  Thermometer,
  Wind,
  Zap,
  Activity as ActivityIcon,
} from "lucide-react"
import {
  Line,
  LineChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts"

import { cn } from "@/lib/utils"
import { useDemo } from "@/lib/demo-context"
import { fetchAllPatients, fetchPatientVitals, type VitalsWithContextResponse } from "@/lib/api"
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
import { type Patient360, type VitalsTimeSeries } from "@/lib/mock-data"

type VitalKey = "heart_rate" | "spo2" | "respiratory_rate" | "temperature"

const VITAL_CONFIG: Record<
  VitalKey,
  { label: string; unit: string; icon: React.ComponentType<{ className?: string }>; colorA: string; colorB: string }
> = {
  heart_rate: { label: "Heart Rate", unit: "bpm", icon: Heart, colorA: "hsl(0, 72%, 51%)", colorB: "hsl(217, 91%, 60%)" },
  spo2: { label: "SpO2", unit: "%", icon: ActivityIcon, colorA: "hsl(0, 72%, 51%)", colorB: "hsl(217, 91%, 60%)" },
  respiratory_rate: { label: "Respiratory Rate", unit: "/min", icon: Wind, colorA: "hsl(0, 72%, 51%)", colorB: "hsl(217, 91%, 60%)" },
  temperature: { label: "Temperature", unit: "°C", icon: Thermometer, colorA: "hsl(0, 72%, 51%)", colorB: "hsl(217, 91%, 60%)" },
}

export function PatientComparison() {
  const { dataVersion } = useDemo()
  const [patients, setPatients] = React.useState<Patient360[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [leftPatientId, setLeftPatientId] = React.useState<string | null>(null)
  const [rightPatientId, setRightPatientId] = React.useState<string | null>(null)
  const [selectedVital, setSelectedVital] = React.useState<VitalKey>("heart_rate")
  const [leftVitals, setLeftVitals] = React.useState<VitalsWithContextResponse | null>(null)
  const [rightVitals, setRightVitals] = React.useState<VitalsWithContextResponse | null>(null)
  const [vitalsLoading, setVitalsLoading] = React.useState(false)
  const [patientLoadMs, setPatientLoadMs] = React.useState<number | null>(null)
  const [vitalsLoadMs, setVitalsLoadMs] = React.useState<number | null>(null)

  React.useEffect(() => {
    setLoading(true)
    const t0 = performance.now()
    fetchAllPatients({ limit: 500 })
      .then((data) => {
        setPatientLoadMs(Math.round(performance.now() - t0))
        setPatients(data)
        setError(null)
        const target = data.find((p) => p.profile_type === "target" && p.active_alerts.length > 0)
        const healthy = data.find((p) => p.profile_type === "healthy")
        setLeftPatientId(target?.patient_id ?? data[0]?.patient_id ?? null)
        setRightPatientId(healthy?.patient_id ?? data[1]?.patient_id ?? null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [dataVersion])

  React.useEffect(() => {
    if (!leftPatientId || !rightPatientId) return
    setVitalsLoading(true)
    const t0 = performance.now()
    Promise.all([
      fetchPatientVitals(leftPatientId, 24).catch(() => null),
      fetchPatientVitals(rightPatientId, 24).catch(() => null),
    ])
      .then(([left, right]) => {
        setVitalsLoadMs(Math.round(performance.now() - t0))
        setLeftVitals(left)
        setRightVitals(right)
      })
      .finally(() => setVitalsLoading(false))
  }, [leftPatientId, rightPatientId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || patients.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{error || "Not enough patients for comparison"}</p>
      </div>
    )
  }

  const leftPatient = patients.find((p) => p.patient_id === leftPatientId)!
  const rightPatient = patients.find((p) => p.patient_id === rightPatientId)!

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Clinical Decision Support — Patient Comparison
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compare any two patients to see how personalized thresholds and clinical context
          change the system&apos;s risk assessment for identical vital signs
        </p>
      </div>

      <Alert className="bg-primary/5 border-primary/20">
        <Info className="h-4 w-4 text-primary" />
        <AlertTitle className="text-primary">How It Works</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          Select any two patients below. The overlay chart shows their vitals on the same
          axes with each patient&apos;s personalized threshold lines, so you can visually see
          how the same reading triggers an alert for one patient but not another.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2">
        <PatientSelector
          label="Patient A"
          selectedPatient={leftPatient}
          onSelect={setLeftPatientId}
          patients={patients}
          excludeId={rightPatientId!}
          color="A"
        />
        <PatientSelector
          label="Patient B"
          selectedPatient={rightPatient}
          onSelect={setRightPatientId}
          patients={patients}
          excludeId={leftPatientId!}
          color="B"
        />
      </div>

      {/* --- Side-by-side vitals chart overlay --- */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-medium">
                Vitals Overlay — 24-Hour Comparison
              </CardTitle>
              <CardDescription>
                Same chart, same axes — different thresholds based on clinical context
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(VITAL_CONFIG) as VitalKey[]).map((key) => {
                const cfg = VITAL_CONFIG[key]
                return (
                  <Button
                    key={key}
                    variant={selectedVital === key ? "default" : "outline"}
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setSelectedVital(key)}
                  >
                    <cfg.icon className="h-3.5 w-3.5" />
                    {cfg.label}
                  </Button>
                )
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {vitalsLoading ? (
            <div className="flex h-[340px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <OverlayChart
              vitalKey={selectedVital}
              leftReadings={leftVitals?.readings ?? null}
              rightReadings={rightVitals?.readings ?? null}
              leftPatient={leftPatient}
              rightPatient={rightPatient}
            />
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: VITAL_CONFIG[selectedVital].colorA }} />
              {leftPatient.demographics.name}
              (threshold {leftPatient.personalized_thresholds[selectedVital].low}–{leftPatient.personalized_thresholds[selectedVital].high} {VITAL_CONFIG[selectedVital].unit})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: VITAL_CONFIG[selectedVital].colorB }} />
              {rightPatient.demographics.name}
              (threshold {rightPatient.personalized_thresholds[selectedVital].low}–{rightPatient.personalized_thresholds[selectedVital].high} {VITAL_CONFIG[selectedVital].unit})
            </span>
          </div>
        </CardContent>
      </Card>

      {/* --- Threshold comparison table --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Personalized Threshold Comparison
          </CardTitle>
          <CardDescription>
            How each patient&apos;s conditions and medications shift their alert boundaries
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Vital Sign</th>
                  <th className="py-2 px-4 font-medium">{leftPatient.demographics.name}</th>
                  <th className="py-2 px-4 font-medium">{rightPatient.demographics.name}</th>
                  <th className="py-2 pl-4 font-medium">Why Different?</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(VITAL_CONFIG) as VitalKey[]).map((key) => {
                  const lT = leftPatient.personalized_thresholds[key]
                  const rT = rightPatient.personalized_thresholds[key]
                  const cfg = VITAL_CONFIG[key]
                  const differ = lT.low !== rT.low || lT.high !== rT.high
                  return (
                    <tr key={key} className={cn("border-b last:border-0", differ && "bg-primary/5")}>
                      <td className="py-2.5 pr-4 font-medium flex items-center gap-1.5">
                        <cfg.icon className="h-3.5 w-3.5 text-muted-foreground" />
                        {cfg.label}
                      </td>
                      <td className="py-2.5 px-4 tabular-nums">
                        {lT.low}–{lT.high} {cfg.unit}
                        {lT.source_rule && (
                          <Badge variant="outline" className="ml-2 text-[10px]">adjusted</Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-4 tabular-nums">
                        {rT.low}–{rT.high} {cfg.unit}
                        {rT.source_rule && (
                          <Badge variant="outline" className="ml-2 text-[10px]">adjusted</Badge>
                        )}
                      </td>
                      <td className="py-2.5 pl-4 text-muted-foreground text-xs">
                        {differ ? explainThresholdDiff(key, leftPatient, rightPatient) : "Same threshold"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* --- Side-by-side patient cards --- */}
      <div className="grid gap-6 md:grid-cols-2">
        <ComparisonCard patient={leftPatient} />
        <ComparisonCard patient={rightPatient} />
      </div>

      {/* --- Key Differences --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Key Differences</CardTitle>
          <CardDescription>How clinical context changes the system response</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <DifferenceCard
              title="Alert Thresholds"
              icon={Shield}
              left={{
                label: leftPatient.demographics.given,
                value: `HR: ${leftPatient.personalized_thresholds.heart_rate.high} bpm`,
                note: leftPatient.flags.has_beta_blocker ? "Beta-blocker adjusted" : "Standard threshold",
              }}
              right={{
                label: rightPatient.demographics.given,
                value: `HR: ${rightPatient.personalized_thresholds.heart_rate.high} bpm`,
                note: rightPatient.flags.has_beta_blocker ? "Beta-blocker adjusted" : "Standard threshold",
              }}
            />
            <DifferenceCard
              title="Risk Assessment"
              icon={AlertTriangle}
              left={{
                label: leftPatient.demographics.given,
                value: `${leftPatient.active_alerts.length} active alerts`,
                note: leftPatient.active_alerts.length > 0 ? leftPatient.active_alerts[0].severity.toUpperCase() : "No alerts",
              }}
              right={{
                label: rightPatient.demographics.given,
                value: `${rightPatient.active_alerts.length} active alerts`,
                note: rightPatient.active_alerts.length > 0 ? rightPatient.active_alerts[0].severity.toUpperCase() : "No alerts",
              }}
            />
            <DifferenceCard
              title="Clinical Factors"
              icon={Pill}
              left={{
                label: leftPatient.demographics.given,
                value: `${leftPatient.medications.length} medications`,
                note: `${leftPatient.conditions.length} conditions`,
              }}
              right={{
                label: rightPatient.demographics.given,
                value: `${rightPatient.medications.length} medications`,
                note: `${rightPatient.conditions.length} conditions`,
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* --- Dynamic clinical intelligence narrative --- */}
      <ContextAnalysis left={leftPatient} right={rightPatient} />

      {/* --- Why MongoDB technical deep-dive --- */}
      <WhyMongoDB
        patientLoadMs={patientLoadMs}
        vitalsLoadMs={vitalsLoadMs}
        patientCount={patients.length}
        leftReadingCount={leftVitals?.total_readings ?? leftVitals?.readings?.length ?? 0}
        rightReadingCount={rightVitals?.total_readings ?? rightVitals?.readings?.length ?? 0}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Overlay chart                                                      */
/* ------------------------------------------------------------------ */

function OverlayChart({
  vitalKey,
  leftReadings,
  rightReadings,
  leftPatient,
  rightPatient,
}: {
  vitalKey: VitalKey
  leftReadings: VitalsTimeSeries[] | null
  rightReadings: VitalsTimeSeries[] | null
  leftPatient: Patient360
  rightPatient: Patient360
}) {
  const cfg = VITAL_CONFIG[vitalKey]
  const lThreshold = leftPatient.personalized_thresholds[vitalKey]
  const rThreshold = rightPatient.personalized_thresholds[vitalKey]

  const merged = React.useMemo(() => {
    const lData = leftReadings ?? []
    const rData = rightReadings ?? []
    const maxLen = Math.max(lData.length, rData.length)
    const rows: Record<string, unknown>[] = []

    for (let i = 0; i < maxLen; i++) {
      const lPoint = lData[i]
      const rPoint = rData[i]
      const ts = lPoint?.timestamp ?? rPoint?.timestamp ?? ""
      rows.push({
        time: ts
          ? new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
          : "",
        patientA: lPoint ? (lPoint[vitalKey] as number) : undefined,
        patientB: rPoint ? (rPoint[vitalKey] as number) : undefined,
      })
    }
    return rows
  }, [leftReadings, rightReadings, vitalKey])

  if (merged.length === 0) {
    return (
      <div className="flex h-[340px] items-center justify-center text-sm text-muted-foreground">
        No vitals data available for comparison
      </div>
    )
  }

  const allValues = merged.flatMap((row) => [row.patientA as number, row.patientB as number]).filter(Boolean)
  const allBounds = [lThreshold.low, lThreshold.high, rThreshold.low, rThreshold.high, ...allValues]
  const minVal = Math.min(...allBounds)
  const maxVal = Math.max(...allBounds)
  const pad = (maxVal - minVal) * 0.12
  const domain: [number, number] = [Math.floor(minVal - pad), Math.ceil(maxVal + pad)]

  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={merged} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="time"
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            tick={{ fill: "var(--muted-foreground)" }}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            domain={domain}
            tick={{ fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            content={({ active, payload, label: tooltipLabel }) => {
              if (!active || !payload?.length) return null
              return (
                <div className="rounded-lg border bg-popover p-3 shadow-md text-sm">
                  <p className="text-xs text-muted-foreground mb-1">{tooltipLabel}</p>
                  {payload.map((entry) => (
                    <div key={entry.dataKey as string} className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: entry.color }}
                      />
                      <span className="text-muted-foreground">
                        {entry.dataKey === "patientA" ? leftPatient.demographics.given : rightPatient.demographics.given}:
                      </span>
                      <span className="font-semibold tabular-nums">
                        {typeof entry.value === "number" ? entry.value.toFixed(1) : "—"}
                      </span>
                      <span className="text-muted-foreground">{cfg.unit}</span>
                    </div>
                  ))}
                </div>
              )
            }}
          />
          <Legend
            verticalAlign="top"
            height={28}
            formatter={(value: string) =>
              value === "patientA" ? leftPatient.demographics.name : rightPatient.demographics.name
            }
          />

          {/* Patient A threshold band */}
          <ReferenceLine
            y={lThreshold.high}
            stroke={cfg.colorA}
            strokeDasharray="6 3"
            strokeOpacity={0.5}
            label={{ value: `A high: ${lThreshold.high}`, position: "insideTopRight", fill: cfg.colorA, fontSize: 10 }}
          />
          <ReferenceLine
            y={lThreshold.low}
            stroke={cfg.colorA}
            strokeDasharray="6 3"
            strokeOpacity={0.35}
          />

          {/* Patient B threshold band */}
          <ReferenceLine
            y={rThreshold.high}
            stroke={cfg.colorB}
            strokeDasharray="3 6"
            strokeOpacity={0.5}
            label={{ value: `B high: ${rThreshold.high}`, position: "insideBottomRight", fill: cfg.colorB, fontSize: 10 }}
          />
          <ReferenceLine
            y={rThreshold.low}
            stroke={cfg.colorB}
            strokeDasharray="3 6"
            strokeOpacity={0.35}
          />

          <Line
            type="monotone"
            dataKey="patientA"
            stroke={cfg.colorA}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="patientB"
            stroke={cfg.colorB}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function PatientSelector({
  label,
  selectedPatient,
  onSelect,
  patients,
  excludeId,
  color,
}: {
  label: string
  selectedPatient: Patient360
  onSelect: (id: string) => void
  patients: Patient360[]
  excludeId: string
  color: "A" | "B"
}) {
  const available = patients.filter((p) => p.patient_id !== excludeId)
  const dotColor = color === "A" ? "bg-red-500" : "bg-blue-500"

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
        <span className={cn("inline-block h-2.5 w-2.5 rounded-full", dotColor)} />
        {label}
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-auto py-3">
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
        <DropdownMenuContent className="w-[340px]">
          {available.map((patient) => (
            <DropdownMenuItem
              key={patient.patient_id}
              onClick={() => onSelect(patient.patient_id)}
              className="py-2"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                  {patient.demographics.given?.[0]}
                  {patient.demographics.family?.[0]}
                </div>
                <div>
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

function ComparisonCard({ patient }: { patient: Patient360 }) {
  const vitals = patient.vitals_summary?.latest
  const thresholds = patient.personalized_thresholds
  const hasCritical = patient.active_alerts.some((a) => a.severity === "critical")
  const hasHigh = patient.active_alerts.some((a) => a.severity === "high")

  return (
    <Card className={cn(hasCritical && "border-destructive/50", hasHigh && !hasCritical && "border-warning/50")}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
              {patient.demographics.given?.[0]}
              {patient.demographics.family?.[0]}
            </div>
            <div>
              <CardTitle className="text-base">{patient.demographics.name}</CardTitle>
              <CardDescription>
                {patient.demographics.age}y {patient.demographics.gender === "female" ? "F" : "M"} |{" "}
                {patient.hospital_name.split(" ")[0]}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ProfileBadge profile={patient.profile_type} />
            <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
              <Link href={`/patients/${patient.patient_id}`}>Detail</Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {vitals && (
          <div className="grid grid-cols-2 gap-3">
            <VitalDisplay icon={Heart} label="Heart Rate" value={vitals.heart_rate} unit="bpm" threshold={thresholds.heart_rate} />
            <VitalDisplay icon={ActivityIcon} label="SpO2" value={vitals.spo2} unit="%" threshold={thresholds.spo2} />
            <VitalDisplay icon={Thermometer} label="Temperature" value={vitals.temperature} unit="°C" threshold={thresholds.temperature} />
            <VitalDisplay icon={Wind} label="Resp Rate" value={vitals.respiratory_rate} unit="/min" threshold={thresholds.respiratory_rate} />
          </div>
        )}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-2">Clinical Context</h4>
          <div className="space-y-1.5 text-sm">
            {patient.conditions.length === 0 ? (
              <div className="text-muted-foreground">No chronic conditions</div>
            ) : (
              patient.conditions.slice(0, 4).map((condition, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-chart-1" />
                  <span className="text-muted-foreground">{getShortCondition(condition.display)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-2">Key Medications</h4>
          <div className="space-y-1.5">
            {patient.medications.length === 0 ? (
              <Badge variant="outline" className="text-muted-foreground">None</Badge>
            ) : (
              patient.medications.slice(0, 4).map((med, i) => {
                const adjustment = getMedThresholdLink(med.display, patient.personalized_thresholds)
                return (
                  <div key={i} className="flex items-center gap-1.5 text-sm">
                    <Badge variant="outline" className="text-xs shrink-0">
                      {med.display.split(" ")[0]}
                    </Badge>
                    {adjustment && (
                      <>
                        <ArrowRight className="h-3 w-3 text-primary shrink-0" />
                        <span className="text-xs text-primary">{adjustment}</span>
                      </>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-2">System Response</h4>
          {patient.active_alerts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              <span>No alerts — vitals within expected range for this patient</span>
            </div>
          ) : (
            <div className="space-y-2">
              {patient.active_alerts.slice(0, 3).map((alert) => (
                <div
                  key={alert.alert_id}
                  className={cn(
                    "flex items-start gap-2 rounded-md p-2.5 text-sm",
                    alert.severity === "critical" && "bg-destructive/10 text-destructive",
                    alert.severity === "high" && "bg-warning/10 text-warning",
                    alert.severity === "moderate" && "bg-muted",
                  )}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {alert.title}
                      <Badge variant="outline" className="text-[10px] uppercase">{alert.severity}</Badge>
                    </div>
                    {alert.reasoning && (
                      <div className="text-xs opacity-80 mt-1 leading-relaxed">
                        {alert.reasoning}
                      </div>
                    )}
                    {alert.suggested_actions && alert.suggested_actions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {alert.suggested_actions.slice(0, 3).map((action, ai) => (
                          <Badge key={ai} variant="secondary" className="text-[10px] font-normal">
                            {action}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function VitalDisplay({
  icon: Icon,
  label,
  value,
  unit,
  threshold,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  unit: string
  threshold: { low: number; high: number; source_rule: string | null }
}) {
  const status = getVitalStatus(value, threshold.low, threshold.high)
  return (
    <div
      className={cn(
        "rounded-md border p-2.5",
        status === "critical" && "border-destructive/50 bg-destructive/5",
        status === "warning" && "border-warning/50 bg-warning/5",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1">
        <span
          className={cn(
            "text-xl font-bold tabular-nums",
            status === "warning" && "text-warning",
            status === "critical" && "text-destructive",
          )}
        >
          {value % 1 !== 0 ? value.toFixed(1) : value}
        </span>
        <span className="text-sm text-muted-foreground ml-1">{unit}</span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        Threshold: {threshold.low}–{threshold.high}
      </div>
    </div>
  )
}

function DifferenceCard({
  title,
  icon: Icon,
  left,
  right,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  left: { label: string; value: string; note: string }
  right: { label: string; value: string; note: string }
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title}</span>
      </div>
      <div className="space-y-3">
        <div>
          <div className="text-xs text-muted-foreground">{left.label}</div>
          <div className="font-medium">{left.value}</div>
          <div className="text-xs text-primary">{left.note}</div>
        </div>
        <div className="border-t" />
        <div>
          <div className="text-xs text-muted-foreground">{right.label}</div>
          <div className="font-medium">{right.value}</div>
          <div className="text-xs text-muted-foreground">{right.note}</div>
        </div>
      </div>
    </div>
  )
}

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

/* ------------------------------------------------------------------ */
/*  Context Analysis — dynamic narrative                               */
/* ------------------------------------------------------------------ */

function ContextAnalysis({ left, right }: { left: Patient360; right: Patient360 }) {
  const insights = React.useMemo(() => buildContextInsights(left, right), [left, right])

  if (insights.length === 0) return null

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          Why Context Matters — Live Analysis
        </CardTitle>
        <CardDescription>
          How the CDS engine interprets the same vitals differently based on each
          patient&apos;s clinical profile
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A traditional monitoring system would apply <strong>one threshold</strong> to
            all patients. Our engine evaluates {left.demographics.given}&apos;s{" "}
            {left.conditions.length} conditions and {left.medications.length} medications
            against {right.demographics.given}&apos;s{" "}
            {right.conditions.length === 0 ? "healthy" : right.conditions.length + " condition"} profile
            and produces fundamentally different assessments:
          </p>
          <div className="space-y-3">
            {insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-3 rounded-md border bg-background p-3">
                <insight.icon className={cn("h-5 w-5 shrink-0 mt-0.5", insight.iconColor)} />
                <div className="space-y-1">
                  <div className="text-sm font-medium">{insight.title}</div>
                  <div className="text-sm text-muted-foreground leading-relaxed">
                    {insight.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {left.active_alerts.length > 0 && right.active_alerts.length === 0 && (
            <div className="rounded-md border-l-4 border-primary bg-background p-4 mt-4">
              <div className="text-sm font-medium mb-1">The Takeaway</div>
              <div className="text-sm text-muted-foreground">
                The system generated <strong>{left.active_alerts.length} alert{left.active_alerts.length > 1 ? "s" : ""}</strong> for{" "}
                {left.demographics.given} and <strong>zero alerts</strong> for {right.demographics.given} —
                not because their vitals are dramatically different, but because their clinical context
                demands different interpretation. This is the difference between generic monitoring
                and personalized clinical decision support.
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

interface ContextInsight {
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  title: string
  description: string
}

function buildContextInsights(left: Patient360, right: Patient360): ContextInsight[] {
  const insights: ContextInsight[] = []
  const lName = left.demographics.given
  const rName = right.demographics.given
  const lLatest = left.vitals_summary?.latest
  const rLatest = right.vitals_summary?.latest

  // HR threshold difference — beta-blocker
  if (left.personalized_thresholds.heart_rate.high !== right.personalized_thresholds.heart_rate.high) {
    const lHigh = left.personalized_thresholds.heart_rate.high
    const rHigh = right.personalized_thresholds.heart_rate.high
    const bbPatient = left.flags.has_beta_blocker ? left : right
    const bbName = bbPatient.demographics.given
    const otherName = bbPatient === left ? rName : lName
    const bbMed = bbPatient.medications.find(
      (m) => /atenolol|metoprolol|propranolol/i.test(m.display),
    )
    const medName = bbMed?.display.split(" ")[0] ?? "beta-blocker"

    let hrContext = ""
    if (lLatest?.heart_rate && rLatest?.heart_rate) {
      const bbHr = bbPatient === left ? lLatest.heart_rate : rLatest.heart_rate
      const otherHr = bbPatient === left ? rLatest.heart_rate : lLatest.heart_rate
      const bbBreaches = bbHr > (bbPatient === left ? lHigh : rHigh)
      const otherBreaches = otherHr > (bbPatient === left ? rHigh : lHigh)
      if (bbBreaches && !otherBreaches) {
        hrContext = ` Right now, ${bbName}'s HR of ${bbHr.toFixed(0)} bpm breaches the ${bbPatient === left ? lHigh : rHigh} bpm ceiling, while ${otherName}'s ${otherHr.toFixed(0)} bpm is safely within the ${bbPatient === left ? rHigh : lHigh} bpm standard limit.`
      }
    }

    insights.push({
      icon: Heart,
      iconColor: "text-red-500",
      title: `Heart Rate: ${lHigh} bpm threshold vs ${rHigh} bpm`,
      description: `${bbName} is on ${medName}, which should suppress resting HR to 55-75 bpm. ` +
        `Any reading above ${bbPatient === left ? lHigh : rHigh} bpm is clinically significant — ` +
        `it may indicate infection, hypoglycemia, or medication non-compliance. ` +
        `${otherName}'s standard threshold remains at ${bbPatient === left ? rHigh : lHigh} bpm.${hrContext}`,
    })
  }

  // SpO2 threshold difference — CKD
  if (left.personalized_thresholds.spo2.low !== right.personalized_thresholds.spo2.low) {
    const lLow = left.personalized_thresholds.spo2.low
    const rLow = right.personalized_thresholds.spo2.low
    const ckdPatient = left.flags.has_ckd ? left : right
    const ckdName = ckdPatient.demographics.given
    const otherName = ckdPatient === left ? rName : lName

    insights.push({
      icon: ActivityIcon,
      iconColor: "text-blue-500",
      title: `SpO2: ${ckdName}'s floor is ${ckdPatient === left ? lLow : rLow}% vs ${ckdPatient === left ? rLow : lLow}%`,
      description: `CKD Stage 3 causes chronic mild oxygen desaturation. ` +
        `An SpO2 of 92% for ${ckdName} is near their expected baseline — not alarming. ` +
        `The same reading for ${otherName} would breach the ${ckdPatient === left ? rLow : lLow}% threshold ` +
        `and trigger an immediate alert.`,
    })
  }

  // RR threshold difference — CKD respiratory compensation
  if (left.personalized_thresholds.respiratory_rate.high !== right.personalized_thresholds.respiratory_rate.high) {
    const lHigh = left.personalized_thresholds.respiratory_rate.high
    const rHigh = right.personalized_thresholds.respiratory_rate.high
    const ckdPatient = left.flags.has_ckd ? left : right
    const ckdName = ckdPatient.demographics.given

    insights.push({
      icon: Wind,
      iconColor: "text-teal-500",
      title: `Respiratory Rate: adjusted ceiling for metabolic compensation`,
      description: `${ckdName}'s CKD causes mild metabolic acidosis, ` +
        `leading to compensatory respiratory rate increases (Kussmaul breathing). ` +
        `The system raises the RR alert threshold from ${Math.min(lHigh, rHigh)} to ` +
        `${Math.max(lHigh, rHigh)} breaths/min to avoid false alarms from expected physiology.`,
    })
  }

  // Alert count difference
  if (left.active_alerts.length !== right.active_alerts.length) {
    const moreAlerts = left.active_alerts.length > right.active_alerts.length ? left : right
    const fewerAlerts = moreAlerts === left ? right : left
    const alertTitles = moreAlerts.active_alerts.map((a) => a.title)

    insights.push({
      icon: AlertTriangle,
      iconColor: "text-amber-500",
      title: `${moreAlerts.demographics.given}: ${moreAlerts.active_alerts.length} alerts vs ${fewerAlerts.demographics.given}: ${fewerAlerts.active_alerts.length}`,
      description: `The CDS engine fired ${moreAlerts.active_alerts.length} rule${moreAlerts.active_alerts.length > 1 ? "s" : ""} ` +
        `for ${moreAlerts.demographics.given}: ${alertTitles.join("; ")}. ` +
        (fewerAlerts.active_alerts.length === 0
          ? `${fewerAlerts.demographics.given}'s vitals fall within standard ranges — no rules triggered.`
          : `${fewerAlerts.demographics.given} has ${fewerAlerts.active_alerts.length} alert${fewerAlerts.active_alerts.length > 1 ? "s" : ""}.`),
    })
  }

  return insights
}

/* ------------------------------------------------------------------ */
/*  Why MongoDB — technical deep-dive                                  */
/* ------------------------------------------------------------------ */

function WhyMongoDB({
  patientLoadMs,
  vitalsLoadMs,
  patientCount,
  leftReadingCount,
  rightReadingCount,
}: {
  patientLoadMs: number | null
  vitalsLoadMs: number | null
  patientCount: number
  leftReadingCount: number
  rightReadingCount: number
}) {
  const totalReadings = leftReadingCount + rightReadingCount

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Database className="h-5 w-5 text-[#00684A]" />
          Technical Deep Dive: Why MongoDB
        </CardTitle>
        <CardDescription>
          How MongoDB Atlas powers the clinical intelligence layer you just saw
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#00684A]" />
              <span className="font-medium text-sm">Document Model</span>
            </div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              Each Patient 360 — demographics, conditions, medications, labs,
              personalized thresholds, alerts, and care gaps — lives in{" "}
              <strong>one document</strong>. A relational database would require
              7+ table joins to assemble the same view.
            </div>
            {patientLoadMs !== null && (
              <div className="flex items-center gap-2 rounded-md bg-[#00684A]/10 px-3 py-2">
                <Clock className="h-3.5 w-3.5 text-[#00684A]" />
                <span className="text-sm font-mono font-semibold text-[#00684A]">
                  {patientLoadMs}ms
                </span>
                <span className="text-xs text-muted-foreground">
                  to load {patientCount} complete Patient 360 documents
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#00684A]" />
              <span className="font-medium text-sm">Time Series Collections</span>
            </div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              Wearable vitals stream into MongoDB&apos;s native time series collections
              with automatic bucketing, compression, and temporal indexing — optimized
              for high-frequency writes and range queries.
            </div>
            {vitalsLoadMs !== null && totalReadings > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-[#00684A]/10 px-3 py-2">
                <Clock className="h-3.5 w-3.5 text-[#00684A]" />
                <span className="text-sm font-mono font-semibold text-[#00684A]">
                  {vitalsLoadMs}ms
                </span>
                <span className="text-xs text-muted-foreground">
                  to query {totalReadings.toLocaleString()} vitals readings (24h x 2 patients)
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#00684A]" />
              <span className="font-medium text-sm">Change Streams + Materialization</span>
            </div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              When new vitals arrive, MongoDB Change Streams trigger incremental
              updates to the Patient 360 document. The CDS engine evaluates rules
              in real-time — no batch ETL, no stale data, no delayed alerts.
            </div>
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                5 CDS rules evaluated per patient on every vitals update
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getMedThresholdLink(
  medDisplay: string,
  thresholds: Patient360["personalized_thresholds"],
): string | null {
  const lower = medDisplay.toLowerCase()
  if (/atenolol|metoprolol|propranolol/i.test(lower) && thresholds.heart_rate.source_rule) {
    return `HR threshold lowered to ${thresholds.heart_rate.high} bpm`
  }
  return null
}

function getVitalStatus(value: number, low: number, high: number): "normal" | "warning" | "critical" {
  if (value < low * 0.9 || value > high * 1.1) return "critical"
  if (value < low || value > high) return "warning"
  return "normal"
}

function getShortCondition(display: string): string {
  const shortNames: Record<string, string> = {
    "Type 2 diabetes mellitus": "Type 2 Diabetes",
    "Type 2 diabetes mellitus with hyperglycemia": "Type 2 Diabetes",
    "Chronic kidney disease stage 3": "CKD Stage 3",
    "Chronic kidney disease stage 4": "CKD Stage 4",
    "Essential hypertension": "Hypertension",
    "Peripheral neuropathy": "Peripheral Neuropathy",
    "Congestive heart failure": "Heart Failure",
    "Atrial fibrillation": "Atrial Fibrillation",
    "Chronic obstructive pulmonary disease": "COPD",
  }
  return shortNames[display] || display
}

function explainThresholdDiff(key: VitalKey, left: Patient360, right: Patient360): string {
  const reasons: string[] = []
  if (key === "heart_rate") {
    if (left.flags.has_beta_blocker !== right.flags.has_beta_blocker)
      reasons.push("beta-blocker therapy shifts HR ceiling")
  }
  if (key === "spo2") {
    if (left.flags.has_ckd !== right.flags.has_ckd)
      reasons.push("CKD lowers baseline SpO2 expectation")
  }
  if (key === "respiratory_rate") {
    const leftHasCHF = left.flags.condition_codes.includes("42343007")
    const rightHasCHF = right.flags.condition_codes.includes("42343007")
    if (left.flags.has_ckd !== right.flags.has_ckd) reasons.push("CKD affects respiratory compensation")
    if (leftHasCHF !== rightHasCHF) reasons.push("CHF adjusts RR ceiling")
  }
  return reasons.length > 0 ? reasons.join("; ") : "Different clinical profile"
}
