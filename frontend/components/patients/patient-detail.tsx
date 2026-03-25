"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  Heart,
  Loader2,
  MessageSquareText,
  Pill,
  Plus,
  Stethoscope,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Wind,
  Activity as ActivityIcon,
  AlertCircle,
  CheckCircle2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  fetchPatientDetail,
  fetchPatientVitals,
  type PatientDetailResponse,
  type VitalsWithContextResponse,
} from "@/lib/api"
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
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type Patient360, type VitalsTimeSeries } from "@/lib/mock-data"
import { VitalsChart, type ChartAnnotation } from "@/components/patients/vitals-chart"

interface PatientDetailProps {
  patientId: string
}

export function PatientDetail({ patientId }: PatientDetailProps) {
  const [detailData, setDetailData] = React.useState<PatientDetailResponse | null>(null)
  const [vitalsData, setVitalsData] = React.useState<VitalsWithContextResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [vitalsHours, setVitalsHours] = React.useState(24)
  const [annotations, setAnnotations] = React.useState<ChartAnnotation[]>([])
  const [showAnnotationDialog, setShowAnnotationDialog] = React.useState(false)
  const [annotationLabel, setAnnotationLabel] = React.useState("")
  const [annotationType, setAnnotationType] = React.useState<ChartAnnotation["type"]>("note")

  React.useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchPatientDetail(patientId),
      fetchPatientVitals(patientId, vitalsHours),
    ])
      .then(([detail, vitals]) => {
        setDetailData(detail)
        setVitalsData(vitals)
        setError(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [patientId, vitalsHours])

  React.useEffect(() => {
    if (!detailData) return
    setAnnotations(buildAutoAnnotations(detailData.patient))
  }, [detailData])

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
    conditions,
    medications,
    labs,
    active_alerts,
    care_gaps,
    vitals_summary,
    flags,
    personalized_thresholds,
  } = patient

  const readings = (vitalsData?.readings ?? []) as VitalsTimeSeries[]
  const thresholds = vitalsData?.thresholds ?? personalized_thresholds
  const narrative = generateClinicalNarrative(patient)

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

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ---- Header ---- */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/patients">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to patients</span>
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{demographics.name}</h1>
            <Badge variant="outline" className="text-sm">
              {demographics.age}y {demographics.gender === "female" ? "F" : "M"}
            </Badge>
            <ProfileBadge profile={patient.profile_type} />
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
            <span>MRN: {patient.mrn}</span>
            <span className="hidden sm:inline">{patient.hospital_name}</span>
            {detailData.time_since_last_alert && (
              <span>Last alert: {detailData.time_since_last_alert}</span>
            )}
          </div>
        </div>
      </div>

      {/* ---- Clinical narrative summary ---- */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <MessageSquareText className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-primary mb-1">Clinical Summary</p>
              <p className="text-sm text-foreground leading-relaxed">{narrative}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---- Active alert banners ---- */}
      {active_alerts.length > 0 && (
        <div className="space-y-2">
          {active_alerts
            .filter((a) => a.severity === "critical")
            .map((alert) => (
              <AlertBanner key={alert.alert_id} alert={alert} />
            ))}
          {active_alerts
            .filter((a) => a.severity === "high")
            .map((alert) => (
              <AlertBanner key={alert.alert_id} alert={alert} />
            ))}
        </div>
      )}

      {/* ---- Main content grid ---- */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Current vitals row */}
          {vitals_summary && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">Current Vitals</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    Updated {formatRelativeTime(vitals_summary.refreshed_at)}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <VitalCard
                    icon={Heart}
                    label="Heart Rate"
                    value={vitals_summary.latest.heart_rate}
                    unit="bpm"
                    trend={vitals_summary.trend_24h.heart_rate}
                    threshold={personalized_thresholds.heart_rate}
                    contextNote={flags.has_beta_blocker ? "On beta-blocker" : undefined}
                  />
                  <VitalCard
                    icon={ActivityIcon}
                    label="SpO2"
                    value={vitals_summary.latest.spo2}
                    unit="%"
                    trend={vitals_summary.trend_24h.spo2}
                    threshold={personalized_thresholds.spo2}
                    contextNote={flags.has_ckd ? "CKD adjusted" : undefined}
                  />
                  <VitalCard
                    icon={Wind}
                    label="Resp Rate"
                    value={vitals_summary.latest.respiratory_rate}
                    unit="/min"
                    trend={vitals_summary.trend_24h.respiratory_rate}
                    threshold={personalized_thresholds.respiratory_rate}
                  />
                  <VitalCard
                    icon={Thermometer}
                    label="Temperature"
                    value={vitals_summary.latest.temperature}
                    unit="°C"
                    trend={vitals_summary.trend_24h.temperature}
                    threshold={personalized_thresholds.temperature}
                  />
                  <VitalCard
                    icon={Stethoscope}
                    label="Activity"
                    value={vitals_summary.latest.activity_level}
                    unit="METs"
                    trend={vitals_summary.trend_24h.activity_level}
                    threshold={personalized_thresholds.activity_level}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Vitals chart with annotations */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-medium">
                    Vitals Trend ({vitalsHours}h)
                  </CardTitle>
                  <CardDescription>
                    Real-time monitoring data with personalized thresholds
                    {vitalsData && ` — ${vitalsData.total_readings} readings`}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setShowAnnotationDialog(true)}
                  >
                    <Plus className="h-3 w-3" />
                    Annotate
                  </Button>
                  <div className="flex gap-1">
                    {[6, 12, 24, 48, 72, 168].map((h) => (
                      <Button
                        key={h}
                        variant={vitalsHours === h ? "default" : "outline"}
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setVitalsHours(h)}
                      >
                        {h}h
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {readings.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No vitals data available for this time window
                </p>
              ) : (
                <Tabs defaultValue="heart_rate" className="w-full">
                  <TabsList className="mb-4">
                    <TabsTrigger value="heart_rate">Heart Rate</TabsTrigger>
                    <TabsTrigger value="spo2">SpO2</TabsTrigger>
                    <TabsTrigger value="respiratory">Resp Rate</TabsTrigger>
                    <TabsTrigger value="temperature">Temp</TabsTrigger>
                  </TabsList>
                  <TabsContent value="heart_rate">
                    <VitalsChart
                      data={readings}
                      dataKey="heart_rate"
                      label="Heart Rate"
                      unit="bpm"
                      color="var(--chart-1)"
                      threshold={thresholds.heart_rate}
                      annotations={annotations}
                    />
                  </TabsContent>
                  <TabsContent value="spo2">
                    <VitalsChart
                      data={readings}
                      dataKey="spo2"
                      label="SpO2"
                      unit="%"
                      color="var(--chart-2)"
                      threshold={thresholds.spo2}
                      annotations={annotations}
                    />
                  </TabsContent>
                  <TabsContent value="respiratory">
                    <VitalsChart
                      data={readings}
                      dataKey="respiratory_rate"
                      label="Respiratory Rate"
                      unit="/min"
                      color="var(--chart-3)"
                      threshold={thresholds.respiratory_rate}
                      annotations={annotations}
                    />
                  </TabsContent>
                  <TabsContent value="temperature">
                    <VitalsChart
                      data={readings}
                      dataKey="temperature"
                      label="Temperature"
                      unit="°C"
                      color="var(--chart-4)"
                      threshold={thresholds.temperature}
                      annotations={annotations}
                    />
                  </TabsContent>
                </Tabs>
              )}

              {/* Annotation log */}
              {annotations.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Chart Annotations
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {annotations.map((ann, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className={cn(
                          "text-xs gap-1",
                          ann.type === "event" && "border-warning/50 text-warning",
                          ann.type === "medication" && "border-primary/50 text-primary",
                        )}
                      >
                        {ann.type === "medication" && <Pill className="h-3 w-3" />}
                        {ann.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ---- Right sidebar ---- */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Clinical Context</CardTitle>
              <CardDescription>Factors affecting alert thresholds</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <ContextFlag
                  label="Beta-blocker therapy"
                  active={flags.has_beta_blocker}
                  effect="HR threshold: 90 bpm (vs 100)"
                />
                <ContextFlag
                  label="Insulin therapy"
                  active={flags.has_insulin}
                  effect="Hypoglycemia monitoring enabled"
                />
                <ContextFlag
                  label="CKD patient"
                  active={flags.has_ckd}
                  effect="SpO2 threshold: 92% (vs 95)"
                />
                <ContextFlag
                  label="ACE inhibitor"
                  active={flags.has_ace_inhibitor}
                  effect="Potassium monitoring"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Active Conditions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {conditions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active conditions</p>
                ) : (
                  conditions.map((condition, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <div className="mt-0.5 h-2 w-2 rounded-full bg-chart-1" />
                      <div className="flex-1">
                        <span>{condition.display}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          ({condition.icd10})
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Pill className="h-4 w-4" />
                Medications
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {medications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active medications</p>
                ) : (
                  medications.map((med, i) => (
                    <div key={i} className="text-sm">
                      <div className="font-medium">{med.display}</div>
                      <div className="text-xs text-muted-foreground">
                        {med.dose} - {med.frequency}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Recent Labs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {labs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent labs</p>
                ) : (
                  labs.map((lab, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="truncate">{lab.display}</span>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "font-mono tabular-nums",
                            (lab.interpretation === "H" || lab.interpretation === "HH") &&
                              "text-destructive",
                            (lab.interpretation === "L" || lab.interpretation === "LL") &&
                              "text-warning",
                          )}
                        >
                          {lab.value} {lab.unit}
                        </span>
                        {(lab.interpretation === "H" || lab.interpretation === "HH") && (
                          <Badge variant="destructive" className="text-[10px] px-1">
                            H
                          </Badge>
                        )}
                        {(lab.interpretation === "L" || lab.interpretation === "LL") && (
                          <Badge className="text-[10px] px-1 bg-warning text-warning-foreground">
                            L
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {care_gaps.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Care Gaps</CardTitle>
                <CardDescription>HEDIS quality measures</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {care_gaps.map((gap, i) => (
                    <div key={i} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{gap.hedis_measure}</span>
                        <Badge
                          variant={gap.days_overdue > 0 ? "destructive" : "outline"}
                          className="text-xs"
                        >
                          {gap.days_overdue > 0 ? `${gap.days_overdue}d overdue` : "Due soon"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{gap.measure_name}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

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
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ProfileBadge({ profile }: { profile: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    target: {
      label: "High Risk",
      className: "bg-destructive/10 text-destructive border-destructive/20",
    },
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

function AlertBanner({ alert }: { alert: Patient360["active_alerts"][number] }) {
  const isCritical = alert.severity === "critical"
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        isCritical ? "border-destructive/50 bg-destructive/10" : "border-warning/50 bg-warning/10",
      )}
    >
      <AlertTriangle
        className={cn("h-5 w-5 shrink-0 mt-0.5", isCritical ? "text-destructive" : "text-warning")}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("font-medium", isCritical ? "text-destructive" : "text-warning")}>
            {alert.title}
          </span>
          <Badge
            variant={isCritical ? "destructive" : "default"}
            className={cn("text-xs", !isCritical && "bg-warning text-warning-foreground")}
          >
            {alert.severity}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{alert.reasoning}</p>
        {alert.suggested_actions?.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {alert.suggested_actions.slice(0, 3).map((action, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {action}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function VitalCard({
  icon: Icon,
  label,
  value,
  unit,
  trend,
  threshold,
  contextNote,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  unit: string
  trend: "stable" | "increasing" | "decreasing"
  threshold: { low: number; high: number; source_rule: string | null }
  contextNote?: string
}) {
  const status = getVitalStatus(value, threshold.low, threshold.high)
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        status === "critical" && "border-destructive/50 bg-destructive/5",
        status === "warning" && "border-warning/50 bg-warning/5",
      )}
    >
      <div className="flex items-center justify-between">
        <Icon
          className={cn(
            "h-4 w-4",
            status === "normal" && "text-muted-foreground",
            status === "warning" && "text-warning",
            status === "critical" && "text-destructive",
          )}
        />
        <TrendIndicator trend={trend} />
      </div>
      <div className="mt-2">
        <span
          className={cn(
            "text-2xl font-bold tabular-nums",
            status === "warning" && "text-warning",
            status === "critical" && "text-destructive",
          )}
        >
          {value % 1 !== 0 ? value.toFixed(1) : Math.round(value)}
        </span>
        <span className="text-sm text-muted-foreground ml-1">{unit}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
      {contextNote && <div className="text-[10px] text-primary mt-0.5">{contextNote}</div>}
    </div>
  )
}

function TrendIndicator({ trend }: { trend: "stable" | "increasing" | "decreasing" }) {
  if (trend === "stable")
    return <span className="text-xs text-muted-foreground">Stable</span>
  return (
    <span
      className={cn(
        "flex items-center text-xs",
        trend === "increasing" ? "text-warning" : "text-success",
      )}
    >
      {trend === "increasing" ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
    </span>
  )
}

function ContextFlag({
  label,
  active,
  effect,
}: {
  label: string
  active: boolean
  effect: string
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md p-2 text-sm",
        active ? "bg-primary/5" : "opacity-50",
      )}
    >
      {active ? (
        <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      )}
      <div>
        <div className={cn(active ? "font-medium" : "text-muted-foreground")}>{label}</div>
        {active && <div className="text-xs text-muted-foreground">{effect}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getVitalStatus(
  value: number,
  low: number,
  high: number,
): "normal" | "warning" | "critical" {
  if (value < low * 0.9 || value > high * 1.1) return "critical"
  if (value < low || value > high) return "warning"
  return "normal"
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString()
}

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
