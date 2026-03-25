"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  Heart,
  Loader2,
  Pill,
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
import { fetchPatientDetail, fetchPatientVitals, type PatientDetailResponse, type VitalsWithContextResponse } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type Patient360, type VitalsTimeSeries } from "@/lib/mock-data"
import { VitalsChart } from "@/components/patients/vitals-chart"

interface PatientDetailProps {
  patientId: string
}

export function PatientDetail({ patientId }: PatientDetailProps) {
  const [detailData, setDetailData] = React.useState<PatientDetailResponse | null>(null)
  const [vitalsData, setVitalsData] = React.useState<VitalsWithContextResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [vitalsHours, setVitalsHours] = React.useState(24)

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
  const { demographics, conditions, medications, labs, active_alerts, care_gaps, vitals_summary, flags, personalized_thresholds } = patient

  const readings = (vitalsData?.readings ?? []) as VitalsTimeSeries[]
  const thresholds = vitalsData?.thresholds ?? personalized_thresholds

  return (
    <div className="flex flex-col gap-6 p-6">
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

      {active_alerts.length > 0 && (
        <div className="space-y-2">
          {active_alerts.filter(a => a.severity === "critical").map((alert) => (
            <AlertBanner key={alert.alert_id} alert={alert} />
          ))}
          {active_alerts.filter(a => a.severity === "high").map((alert) => (
            <AlertBanner key={alert.alert_id} alert={alert} />
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
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
                  <VitalCard icon={Heart} label="Heart Rate" value={vitals_summary.latest.heart_rate} unit="bpm"
                    trend={vitals_summary.trend_24h.heart_rate} threshold={personalized_thresholds.heart_rate}
                    contextNote={flags.has_beta_blocker ? "On beta-blocker" : undefined} />
                  <VitalCard icon={ActivityIcon} label="SpO2" value={vitals_summary.latest.spo2} unit="%"
                    trend={vitals_summary.trend_24h.spo2} threshold={personalized_thresholds.spo2}
                    contextNote={flags.has_ckd ? "CKD adjusted" : undefined} />
                  <VitalCard icon={Wind} label="Resp Rate" value={vitals_summary.latest.respiratory_rate} unit="/min"
                    trend={vitals_summary.trend_24h.respiratory_rate} threshold={personalized_thresholds.respiratory_rate} />
                  <VitalCard icon={Thermometer} label="Temperature" value={vitals_summary.latest.temperature} unit="°C"
                    trend={vitals_summary.trend_24h.temperature} threshold={personalized_thresholds.temperature} />
                  <VitalCard icon={Stethoscope} label="Activity" value={vitals_summary.latest.activity_level} unit="METs"
                    trend={vitals_summary.trend_24h.activity_level} threshold={personalized_thresholds.activity_level} />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-medium">Vitals Trend ({vitalsHours}h)</CardTitle>
                  <CardDescription>
                    Real-time monitoring data with personalized thresholds
                    {vitalsData && ` — ${vitalsData.total_readings} readings`}
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  {[6, 12, 24, 48, 72, 168].map((h) => (
                    <Button key={h} variant={vitalsHours === h ? "default" : "outline"} size="sm"
                      className="h-7 px-2 text-xs" onClick={() => setVitalsHours(h)}>
                      {h}h
                    </Button>
                  ))}
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
                    <VitalsChart data={readings} dataKey="heart_rate" label="Heart Rate" unit="bpm"
                      color="var(--chart-1)" threshold={thresholds.heart_rate} />
                  </TabsContent>
                  <TabsContent value="spo2">
                    <VitalsChart data={readings} dataKey="spo2" label="SpO2" unit="%"
                      color="var(--chart-2)" threshold={thresholds.spo2} />
                  </TabsContent>
                  <TabsContent value="respiratory">
                    <VitalsChart data={readings} dataKey="respiratory_rate" label="Respiratory Rate" unit="/min"
                      color="var(--chart-3)" threshold={thresholds.respiratory_rate} />
                  </TabsContent>
                  <TabsContent value="temperature">
                    <VitalsChart data={readings} dataKey="temperature" label="Temperature" unit="°C"
                      color="var(--chart-4)" threshold={thresholds.temperature} />
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Clinical Context</CardTitle>
              <CardDescription>Factors affecting alert thresholds</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <ContextFlag label="Beta-blocker therapy" active={flags.has_beta_blocker} effect="HR threshold: 90 bpm (vs 100)" />
                <ContextFlag label="Insulin therapy" active={flags.has_insulin} effect="Hypoglycemia monitoring enabled" />
                <ContextFlag label="CKD patient" active={flags.has_ckd} effect="SpO2 threshold: 92% (vs 95)" />
                <ContextFlag label="ACE inhibitor" active={flags.has_ace_inhibitor} effect="Potassium monitoring" />
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
                        <span className="text-xs text-muted-foreground ml-2">({condition.icd10})</span>
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
                <Pill className="h-4 w-4" />Medications
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
                      <div className="text-xs text-muted-foreground">{med.dose} - {med.frequency}</div>
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
                        <span className={cn("font-mono tabular-nums",
                          (lab.interpretation === "H" || lab.interpretation === "HH") && "text-destructive",
                          (lab.interpretation === "L" || lab.interpretation === "LL") && "text-warning",
                        )}>{lab.value} {lab.unit}</span>
                        {(lab.interpretation === "H" || lab.interpretation === "HH") && (
                          <Badge variant="destructive" className="text-[10px] px-1">H</Badge>
                        )}
                        {(lab.interpretation === "L" || lab.interpretation === "LL") && (
                          <Badge className="text-[10px] px-1 bg-warning text-warning-foreground">L</Badge>
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
                        <Badge variant={gap.days_overdue > 0 ? "destructive" : "outline"} className="text-xs">
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
  return <Badge variant="outline" className={cn("text-xs", v.className)}>{v.label}</Badge>
}

function AlertBanner({ alert }: { alert: Patient360["active_alerts"][0] }) {
  const isCritical = alert.severity === "critical"
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border p-4",
      isCritical ? "border-destructive/50 bg-destructive/10" : "border-warning/50 bg-warning/10"
    )}>
      <AlertTriangle className={cn("h-5 w-5 shrink-0 mt-0.5", isCritical ? "text-destructive" : "text-warning")} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("font-medium", isCritical ? "text-destructive" : "text-warning")}>{alert.title}</span>
          <Badge variant={isCritical ? "destructive" : "default"} className={cn("text-xs", !isCritical && "bg-warning text-warning-foreground")}>{alert.severity}</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{alert.reasoning}</p>
        {alert.suggested_actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {alert.suggested_actions.slice(0, 3).map((action, i) => (
              <Badge key={i} variant="outline" className="text-xs">{action}</Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function VitalCard({ icon: Icon, label, value, unit, trend, threshold, contextNote }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: number; unit: string
  trend: "stable" | "increasing" | "decreasing"; threshold: { low: number; high: number; source_rule: string | null }
  contextNote?: string
}) {
  const status = getVitalStatus(value, threshold.low, threshold.high)
  return (
    <div className={cn("rounded-lg border p-3",
      status === "critical" && "border-destructive/50 bg-destructive/5",
      status === "warning" && "border-warning/50 bg-warning/5"
    )}>
      <div className="flex items-center justify-between">
        <Icon className={cn("h-4 w-4",
          status === "normal" && "text-muted-foreground",
          status === "warning" && "text-warning",
          status === "critical" && "text-destructive"
        )} />
        <TrendIndicator trend={trend} />
      </div>
      <div className="mt-2">
        <span className={cn("text-2xl font-bold tabular-nums",
          status === "warning" && "text-warning",
          status === "critical" && "text-destructive"
        )}>{value % 1 !== 0 ? value.toFixed(1) : Math.round(value)}</span>
        <span className="text-sm text-muted-foreground ml-1">{unit}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
      {contextNote && <div className="text-[10px] text-primary mt-0.5">{contextNote}</div>}
    </div>
  )
}

function TrendIndicator({ trend }: { trend: "stable" | "increasing" | "decreasing" }) {
  if (trend === "stable") return <span className="text-xs text-muted-foreground">Stable</span>
  return (
    <span className={cn("flex items-center text-xs", trend === "increasing" ? "text-warning" : "text-success")}>
      {trend === "increasing" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
    </span>
  )
}

function ContextFlag({ label, active, effect }: { label: string; active: boolean; effect: string }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md p-2 text-sm", active ? "bg-primary/5" : "opacity-50")}>
      {active ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" /> : <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
      <div>
        <div className={cn(active ? "font-medium" : "text-muted-foreground")}>{label}</div>
        {active && <div className="text-xs text-muted-foreground">{effect}</div>}
      </div>
    </div>
  )
}

function getVitalStatus(value: number, low: number, high: number): "normal" | "warning" | "critical" {
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
