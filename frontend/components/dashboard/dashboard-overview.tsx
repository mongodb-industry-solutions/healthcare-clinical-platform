"use client"

import * as React from "react"
import { AlertTriangle, Activity, Users, ClipboardList, TrendingUp, TrendingDown, ArrowRight, Loader2, Clock3, ListChecks } from "lucide-react"
import Link from "next/link"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { fetchAllPatients } from "@/lib/api"
import { type Patient360 } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

const SHIFT_WINDOW_HOURS = 8

type ActionItem = {
  patient: Patient360
  title: string
  detail: string
  score: number
}

type ActivityItem = {
  id: string
  timestamp: string
  severity: "critical" | "high" | "medium" | "low"
  title: string
  detail: string
  href: string
}

export function DashboardOverview() {
  const [patients, setPatients] = React.useState<Patient360[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    fetchAllPatients({ limit: 500 })
      .then((data) => { setPatients(data); setError(null) })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const criticalPatients = patients.filter(
    (p) => p.active_alerts.some((a) => a.severity === "critical" || a.severity === "high")
  )

  const totalPatients = patients.length
  const criticalAlerts = patients.reduce((sum, p) => sum + p.active_alerts.filter(a => a.severity === "critical").length, 0)
  const highAlerts = patients.reduce((sum, p) => sum + p.active_alerts.filter(a => a.severity === "high").length, 0)
  const openCareGaps = patients.reduce((sum, p) => sum + p.care_gaps.filter(g => g.status === "open").length, 0)
  const overdueGaps = patients.reduce((sum, p) => sum + p.care_gaps.filter(g => g.days_overdue > 0).length, 0)
  const shiftStart = Date.now() - SHIFT_WINDOW_HOURS * 60 * 60 * 1000

  const newCriticalThisShift = patients.reduce(
    (sum, patient) =>
      sum +
      patient.active_alerts.filter(
        (alert) =>
          alert.severity === "critical" &&
          new Date(alert.created_at).getTime() >= shiftStart,
      ).length,
    0,
  )

  const newHighThisShift = patients.reduce(
    (sum, patient) =>
      sum +
      patient.active_alerts.filter(
        (alert) =>
          alert.severity === "high" &&
          new Date(alert.created_at).getTime() >= shiftStart,
      ).length,
    0,
  )

  const newlyOverdueThisShift = patients.reduce(
    (sum, patient) =>
      sum +
      patient.care_gaps.filter((gap) => {
        if (gap.status !== "open" || gap.days_overdue <= 0) return false
        const dueAt = new Date(gap.due_by).getTime()
        return dueAt >= shiftStart && dueAt <= Date.now()
      }).length,
    0,
  )

  const nextActions = React.useMemo(() => rankNextActions(patients), [patients])
  const recentActivity = React.useMemo(() => buildRecentActivity(patients), [patients])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Failed to load dashboard data</p>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    )
  }

  const hospitalBreakdown = {
    st_marys: patients.filter(p => p.source_hospital === "st_marys").length,
    regional_general: patients.filter(p => p.source_hospital === "regional_general").length,
    community_health: patients.filter(p => p.source_hospital === "community_health").length,
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Real-time clinical monitoring across all connected hospital systems
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Patients"
          value={totalPatients}
          description="Active monitoring"
          icon={Users}
          trend={null}
        />
        <StatsCard
          title="Critical Alerts"
          value={criticalAlerts}
          description="Require immediate attention"
          icon={AlertTriangle}
          trend={{
            direction: newCriticalThisShift > 0 ? "up" : "neutral",
            value: newCriticalThisShift,
            label: "since last shift",
          }}
          variant="critical"
        />
        <StatsCard
          title="High Alerts"
          value={highAlerts}
          description="Pending review"
          icon={Activity}
          trend={{
            direction: newHighThisShift > 0 ? "up" : "neutral",
            value: newHighThisShift,
            label: "since last shift",
          }}
          variant="warning"
        />
        <StatsCard
          title="Care Gaps"
          value={openCareGaps}
          description={`${overdueGaps} overdue`}
          icon={ClipboardList}
          trend={{
            direction: newlyOverdueThisShift > 0 ? "up" : "neutral",
            value: newlyOverdueThisShift,
            label: "newly overdue this shift",
          }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <ListChecks className="h-4 w-4 text-primary" />
              Next Actions
            </CardTitle>
            <CardDescription>
              Top actions ranked by alert severity, overdue gaps, and worsening vitals
            </CardDescription>
          </CardHeader>
          <CardContent>
            {nextActions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No urgent actions right now.
              </p>
            ) : (
              <div className="space-y-3">
                {nextActions.slice(0, 5).map((action, idx) => (
                  <Link
                    key={action.patient.patient_id}
                    href={`/patients/${action.patient.patient_id}`}
                    className="flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{action.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{action.detail}</p>
                    </div>
                    <Badge variant={action.score >= 130 ? "destructive" : "secondary"}>
                      {action.score >= 130 ? "urgent" : "priority"}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <Clock3 className="h-4 w-4 text-primary" />
              Recent Activity
            </CardTitle>
            <CardDescription>
              Latest alert and care-gap events across the population
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No recent events.
              </p>
            ) : (
              <div className="space-y-3">
                {recentActivity.slice(0, 8).map((event) => (
                  <Link
                    key={event.id}
                    href={event.href}
                    className="block rounded-md border border-border p-2.5 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{event.title}</p>
                      <Badge
                        variant={event.severity === "critical" ? "destructive" : "outline"}
                        className={cn(
                          event.severity === "high" && "border-warning/60 text-warning",
                        )}
                      >
                        {event.severity}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{event.detail}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{formatRelativeTime(event.timestamp)}</p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-medium">Patients Requiring Attention</CardTitle>
              <CardDescription>
                Patients with active critical or high severity alerts
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/patients" className="gap-1">
                View all
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {criticalPatients.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No critical patients at this time
                </p>
              ) : (
                criticalPatients.map((patient) => (
                  <PatientAlertRow key={patient.patient_id} patient={patient} />
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Hospital Distribution</CardTitle>
            <CardDescription>
              Patients by source hospital system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <HospitalBar 
                name="St. Mary's Medical Center" 
                count={hospitalBreakdown.st_marys}
                total={totalPatients}
                color="bg-chart-1"
              />
              <HospitalBar 
                name="Regional General Hospital" 
                count={hospitalBreakdown.regional_general}
                total={totalPatients}
                color="bg-chart-2"
              />
              <HospitalBar 
                name="Community Health Partners" 
                count={hospitalBreakdown.community_health}
                total={totalPatients}
                color="bg-chart-3"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <QuickLinkCard
          title="Population View"
          description="Browse all monitored patients with vitals and risk indicators"
          href="/patients"
          icon={Users}
        />
        <QuickLinkCard
          title="Compare Patients"
          description="Side-by-side comparison showing context-aware alerting"
          href="/compare"
          icon={Activity}
        />
        <QuickLinkCard
          title="Care Gap Analysis"
          description="HEDIS measures and overdue preventive care"
          href="/care-gaps"
          icon={ClipboardList}
        />
      </div>
    </div>
  )
}

function StatsCard({
  title, value, description, icon: Icon, trend, variant = "default",
}: {
  title: string; value: number; description: string
  icon: React.ComponentType<{ className?: string }>
  trend: {
    direction: "up" | "down" | "neutral"
    value: number
    label: string
  } | null
  variant?: "default" | "critical" | "warning"
}) {
  return (
    <Card className={cn(
      variant === "critical" && "border-destructive/50 bg-destructive/5",
      variant === "warning" && "border-warning/50 bg-warning/5"
    )}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn(
          "h-4 w-4",
          variant === "default" && "text-muted-foreground",
          variant === "critical" && "text-destructive",
          variant === "warning" && "text-warning"
        )} />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className={cn(
            "text-3xl font-bold",
            variant === "critical" && "text-destructive",
            variant === "warning" && "text-warning"
          )}>
            {value}
          </span>
          {trend && trend.value > 0 && (
            <span className={cn(
              "flex items-center text-xs",
              trend.direction === "up" ? "text-destructive" : "text-success"
            )}>
              {trend.direction === "up" ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
              +{trend.value}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
        {trend && (
          <p className="text-[11px] text-muted-foreground mt-1">
            {trend.value > 0 ? `+${trend.value}` : "0"} {trend.label}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function PatientAlertRow({ patient }: { patient: Patient360 }) {
  const criticalAlert = patient.active_alerts.find((a) => a.severity === "critical")
  const highAlert = patient.active_alerts.find((a) => a.severity === "high")
  const primaryAlert = criticalAlert || highAlert

  if (!primaryAlert) return null

  return (
    <Link 
      href={`/patients/${patient.patient_id}`}
      className="flex items-center gap-4 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <span className="text-sm font-medium">
          {patient.demographics.given[0]}{patient.demographics.family[0]}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{patient.demographics.name}</span>
          <Badge variant="outline" className="text-xs">
            {patient.demographics.age}y {patient.demographics.gender === "female" ? "F" : "M"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {primaryAlert.title}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Badge 
          variant={primaryAlert.severity === "critical" ? "destructive" : "default"}
          className={cn(
            primaryAlert.severity === "high" && "bg-warning text-warning-foreground"
          )}
        >
          {primaryAlert.severity}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {patient.hospital_name.split(" ")[0]}
        </span>
      </div>
    </Link>
  )
}

function HospitalBar({ name, count, total, color }: {
  name: string; count: number; total: number; color: string
}) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="truncate">{name}</span>
        <span className="text-muted-foreground">{count}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  )
}

function QuickLinkCard({ title, description, href, icon: Icon }: {
  title: string; description: string; href: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:bg-accent/50">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <CardTitle className="text-base font-medium">{title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  )
}

function rankNextActions(patients: Patient360[]): ActionItem[] {
  return patients
    .map((patient) => {
      const criticalAlerts = patient.active_alerts.filter((alert) => alert.severity === "critical")
      const highAlerts = patient.active_alerts.filter((alert) => alert.severity === "high")
      const overdueGaps = patient.care_gaps.filter((gap) => gap.status === "open" && gap.days_overdue > 0)
      const vitalsRisks = getVitalsRiskSignals(patient)

      const score =
        criticalAlerts.length * 100 +
        highAlerts.length * 55 +
        overdueGaps.reduce((sum, gap) => sum + Math.min(gap.days_overdue, 90) * 0.8, 0) +
        vitalsRisks.length * 14

      if (score <= 0) {
        return null
      }

      const topCritical = criticalAlerts[0]
      const topGap = overdueGaps.sort((a, b) => b.days_overdue - a.days_overdue)[0]

      let title = `Review ${patient.demographics.name}`
      if (topCritical) {
        title = `${patient.demographics.name}: ${topCritical.title}`
      } else if (topGap) {
        title = `${patient.demographics.name}: overdue ${topGap.hedis_measure}`
      } else if (vitalsRisks.length > 0) {
        title = `${patient.demographics.name}: worsening vitals trend`
      }

      const detailBits = [
        criticalAlerts.length > 0 ? `${criticalAlerts.length} critical alert${criticalAlerts.length > 1 ? "s" : ""}` : null,
        highAlerts.length > 0 ? `${highAlerts.length} high alert${highAlerts.length > 1 ? "s" : ""}` : null,
        overdueGaps.length > 0 ? `${overdueGaps.length} overdue care gap${overdueGaps.length > 1 ? "s" : ""}` : null,
        vitalsRisks.length > 0 ? `Vitals: ${vitalsRisks.join(", ")}` : null,
      ].filter(Boolean)

      return {
        patient,
        title,
        detail: detailBits.join(" • "),
        score: Math.round(score),
      }
    })
    .filter((item): item is ActionItem => item !== null)
    .sort((a, b) => b.score - a.score)
}

function getVitalsRiskSignals(patient: Patient360): string[] {
  const trend = patient.vitals_summary.trend_24h
  const latest = patient.vitals_summary.latest
  const thresholds = patient.personalized_thresholds
  const signals: string[] = []

  if (trend.spo2 === "decreasing") signals.push("SpO2 down")
  if (trend.heart_rate === "increasing") signals.push("HR up")
  if (trend.respiratory_rate === "increasing") signals.push("RR up")
  if (latest.spo2 < thresholds.spo2.low) signals.push("SpO2 below threshold")
  if (latest.heart_rate > thresholds.heart_rate.high) signals.push("HR above threshold")
  if (latest.respiratory_rate > thresholds.respiratory_rate.high) signals.push("RR above threshold")

  return signals
}

function buildRecentActivity(patients: Patient360[]): ActivityItem[] {
  const items: ActivityItem[] = []

  patients.forEach((patient) => {
    patient.active_alerts.forEach((alert) => {
      items.push({
        id: `alert-${alert.alert_id}`,
        timestamp: alert.created_at,
        severity: alert.severity,
        title: `${patient.demographics.name}: ${alert.title}`,
        detail: `${capitalize(alert.severity)} alert fired. ${alert.reasoning}`,
        href: `/patients/${patient.patient_id}`,
      })
    })

    patient.care_gaps
      .filter((gap) => gap.status === "open" && gap.days_overdue > 0)
      .forEach((gap) => {
        const severity = gap.priority === "critical" || gap.priority === "high"
          ? gap.priority
          : "medium"
        items.push({
          id: `gap-${patient.patient_id}-${gap.hedis_measure}`,
          timestamp: gap.due_by,
          severity,
          title: `${patient.demographics.name}: ${gap.hedis_measure} overdue`,
          detail: `${gap.measure_name} is ${gap.days_overdue} day${gap.days_overdue === 1 ? "" : "s"} overdue.`,
          href: `/patients/${patient.patient_id}`,
        })
      })

    const vitalsSignals = getVitalsRiskSignals(patient)
    if (vitalsSignals.length > 0) {
      items.push({
        id: `vitals-${patient.patient_id}`,
        timestamp: patient.vitals_summary.latest.timestamp,
        severity: "high",
        title: `${patient.demographics.name}: vitals need review`,
        detail: vitalsSignals.join(", "),
        href: `/patients/${patient.patient_id}`,
      })
    }
  })

  return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
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

function capitalize(value: string): string {
  if (!value) return value
  return `${value[0].toUpperCase()}${value.slice(1)}`
}
