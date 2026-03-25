"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, Clock, Filter, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { fetchAllPatients } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type Patient360 } from "@/lib/mock-data"

type AlertWithPatient = {
  alert: Patient360["active_alerts"][0]
  patient: Patient360
}

export function AlertsView() {
  const [patients, setPatients] = React.useState<Patient360[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [severityFilter, setSeverityFilter] = React.useState<string[]>([])

  React.useEffect(() => {
    fetchAllPatients({ limit: 500 })
      .then((data) => { setPatients(data); setError(null) })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const allAlerts: AlertWithPatient[] = React.useMemo(() => {
    const alerts: AlertWithPatient[] = []
    patients.forEach((patient) => {
      patient.active_alerts.forEach((alert) => {
        alerts.push({ alert, patient })
      })
    })
    return alerts.sort((a, b) => {
      const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
      const severityDiff = (severityOrder[a.alert.severity] ?? 4) - (severityOrder[b.alert.severity] ?? 4)
      if (severityDiff !== 0) return severityDiff
      return new Date(b.alert.created_at).getTime() - new Date(a.alert.created_at).getTime()
    })
  }, [patients])

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
        <p className="text-sm text-muted-foreground">Failed to load alerts</p>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    )
  }

  const filteredAlerts = severityFilter.length === 0
    ? allAlerts
    : allAlerts.filter((a) => severityFilter.includes(a.alert.severity))

  const criticalAlerts = filteredAlerts.filter((a) => a.alert.severity === "critical")
  const highAlerts = filteredAlerts.filter((a) => a.alert.severity === "high")

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Active Alerts</h1>
          <p className="text-sm text-muted-foreground">
            {allAlerts.length} total alerts across {patients.filter(p => p.active_alerts.length > 0).length} patients
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                <Filter className="h-3.5 w-3.5" />
                Severity
                {severityFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5">{severityFilter.length}</Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Filter by Severity</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {["critical", "high", "medium", "low"].map((severity) => (
                <DropdownMenuCheckboxItem key={severity}
                  checked={severityFilter.includes(severity)}
                  onCheckedChange={(checked) => {
                    setSeverityFilter(checked
                      ? [...severityFilter, severity]
                      : severityFilter.filter((s) => s !== severity))
                  }}
                >
                  <span className="capitalize">{severity}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {severityFilter.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setSeverityFilter([])}>Clear</Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all" className="gap-2">All <Badge variant="secondary" className="h-5 px-1.5">{filteredAlerts.length}</Badge></TabsTrigger>
          <TabsTrigger value="critical" className="gap-2">Critical <Badge variant="destructive" className="h-5 px-1.5">{criticalAlerts.length}</Badge></TabsTrigger>
          <TabsTrigger value="high" className="gap-2">High <Badge className="h-5 px-1.5 bg-warning text-warning-foreground">{highAlerts.length}</Badge></TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="space-y-3">
          {filteredAlerts.length === 0 ? <EmptyState /> : filteredAlerts.map((item) => <AlertCard key={item.alert.alert_id} {...item} />)}
        </TabsContent>
        <TabsContent value="critical" className="space-y-3">
          {criticalAlerts.length === 0 ? <EmptyState message="No critical alerts" /> : criticalAlerts.map((item) => <AlertCard key={item.alert.alert_id} {...item} />)}
        </TabsContent>
        <TabsContent value="high" className="space-y-3">
          {highAlerts.length === 0 ? <EmptyState message="No high severity alerts" /> : highAlerts.map((item) => <AlertCard key={item.alert.alert_id} {...item} />)}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function AlertCard({ alert, patient }: AlertWithPatient) {
  const isCritical = alert.severity === "critical"
  const isHigh = alert.severity === "high"

  return (
    <Card className={cn(isCritical && "border-destructive/50", isHigh && "border-warning/50")}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            isCritical && "bg-destructive/10", isHigh && "bg-warning/10", !isCritical && !isHigh && "bg-muted"
          )}>
            <AlertTriangle className={cn("h-5 w-5",
              isCritical && "text-destructive", isHigh && "text-warning", !isCritical && !isHigh && "text-muted-foreground"
            )} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{alert.title}</span>
                  <Badge variant={isCritical ? "destructive" : "default"}
                    className={cn("text-xs", isHigh && "bg-warning text-warning-foreground")}>{alert.severity}</Badge>
                  <Badge variant="outline" className="text-xs">{alert.status}</Badge>
                </div>
                <Link href={`/patients/${patient.patient_id}`} className="text-sm text-muted-foreground hover:text-primary">
                  {patient.demographics.name} ({patient.demographics.age}y) - {patient.hospital_name.split(" ")[0]}
                </Link>
              </div>
              <Button variant="ghost" size="icon" asChild className="shrink-0">
                <Link href={`/patients/${patient.patient_id}`}><ChevronRight className="h-4 w-4" /></Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{alert.reasoning}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatRelativeTime(alert.created_at)}</div>
              {alert.suggested_actions.length > 0 && (
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{alert.suggested_actions.length} suggested actions</div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyState({ message = "No alerts found" }: { message?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Bell className="h-12 w-12 text-muted-foreground/50" />
        <p className="text-muted-foreground mt-4">{message}</p>
      </CardContent>
    </Card>
  )
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
