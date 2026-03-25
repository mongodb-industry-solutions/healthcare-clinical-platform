"use client"

import { AlertTriangle, Activity, Users, ClipboardList, TrendingUp, TrendingDown, ArrowRight } from "lucide-react"
import Link from "next/link"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { mockPatients, dashboardStats } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

export function DashboardOverview() {
  // Get patients with active critical/high alerts
  const criticalPatients = mockPatients.filter(
    (p) => p.active_alerts.some((a) => a.severity === "critical" || a.severity === "high")
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Real-time clinical monitoring across all connected hospital systems
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Patients"
          value={dashboardStats.totalPatients}
          description="Active monitoring"
          icon={Users}
          trend={null}
        />
        <StatsCard
          title="Critical Alerts"
          value={dashboardStats.criticalAlerts}
          description="Require immediate attention"
          icon={AlertTriangle}
          trend={null}
          variant="critical"
        />
        <StatsCard
          title="High Alerts"
          value={dashboardStats.highAlerts}
          description="Pending review"
          icon={Activity}
          trend={null}
          variant="warning"
        />
        <StatsCard
          title="Care Gaps"
          value={dashboardStats.openCareGaps}
          description={`${dashboardStats.overdueGaps} overdue`}
          icon={ClipboardList}
          trend={null}
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Critical Patients - Takes more space */}
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

        {/* Hospital Distribution */}
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
                count={dashboardStats.hospitalBreakdown.st_marys}
                total={dashboardStats.totalPatients}
                color="bg-chart-1"
              />
              <HospitalBar 
                name="Regional General Hospital" 
                count={dashboardStats.hospitalBreakdown.regional_general}
                total={dashboardStats.totalPatients}
                color="bg-chart-2"
              />
              <HospitalBar 
                name="Community Health Partners" 
                count={dashboardStats.hospitalBreakdown.community_health}
                total={dashboardStats.totalPatients}
                color="bg-chart-3"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
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
  trend: "up" | "down" | null
  variant?: "default" | "critical" | "warning"
}) {
  return (
    <Card className={cn(
      variant === "critical" && "border-destructive/50 bg-destructive/5",
      variant === "warning" && "border-warning/50 bg-warning/5"
    )}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
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
          {trend && (
            <span className={cn(
              "flex items-center text-xs",
              trend === "up" ? "text-destructive" : "text-green-500"
            )}>
              {trend === "up" ? (
                <TrendingUp className="h-3 w-3 mr-0.5" />
              ) : (
                <TrendingDown className="h-3 w-3 mr-0.5" />
              )}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  )
}

function PatientAlertRow({ patient }: { patient: typeof mockPatients[0] }) {
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

function HospitalBar({
  name,
  count,
  total,
  color,
}: {
  name: string
  count: number
  total: number
  color: string
}) {
  const percentage = Math.round((count / total) * 100)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="truncate">{name}</span>
        <span className="text-muted-foreground">{count}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary">
        <div 
          className={cn("h-full rounded-full", color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

function QuickLinkCard({
  title,
  description,
  href,
  icon: Icon,
}: {
  title: string
  description: string
  href: string
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
