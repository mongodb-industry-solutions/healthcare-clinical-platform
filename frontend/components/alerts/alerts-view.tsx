"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  Filter,
  Loader2,
  TrendingUp,
  XCircle,
} from "lucide-react"

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
  alert: Patient360["active_alerts"][number]
  patient: Patient360
}

type AlertActionState = "reviewed" | "escalated" | "dismissed"

type AlertGroup = {
  patient: Patient360
  alerts: AlertWithPatient[]
}

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function AlertsView() {
  const [patients, setPatients] = React.useState<Patient360[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [severityFilter, setSeverityFilter] = React.useState<string[]>([])
  const [timeWindowHours, setTimeWindowHours] = React.useState<6 | 12 | 24>(6)
  const [alertActions, setAlertActions] = React.useState<Record<string, AlertActionState>>({})

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
      const severityDiff = (severityOrder[a.alert.severity] ?? 4) - (severityOrder[b.alert.severity] ?? 4)
      if (severityDiff !== 0) return severityDiff
      return new Date(b.alert.created_at).getTime() - new Date(a.alert.created_at).getTime()
    })
  }, [patients])

  const visibleAlerts = (severityFilter.length === 0
    ? allAlerts
    : allAlerts.filter((a) => severityFilter.includes(a.alert.severity))
  ).filter((a) => resolveAlertState(a.alert, alertActions[a.alert.alert_id]) !== "dismissed")

  const criticalAlerts = visibleAlerts.filter((a) => a.alert.severity === "critical")
  const highAlerts = visibleAlerts.filter((a) => a.alert.severity === "high")

  const groupedAlerts = React.useMemo<AlertGroup[]>(() => {
    const groupMap = new Map<string, AlertGroup>()
    visibleAlerts.forEach((item) => {
      const existing = groupMap.get(item.patient.patient_id)
      if (!existing) {
        groupMap.set(item.patient.patient_id, {
          patient: item.patient,
          alerts: [item],
        })
        return
      }
      existing.alerts.push(item)
    })

    const groups = Array.from(groupMap.values())
    groups.forEach((group) => {
      group.alerts.sort((a, b) => {
        const severityDiff = (severityOrder[a.alert.severity] ?? 4) - (severityOrder[b.alert.severity] ?? 4)
        if (severityDiff !== 0) return severityDiff
        return new Date(b.alert.created_at).getTime() - new Date(a.alert.created_at).getTime()
      })
    })

    return groups.sort((a, b) => {
      const aTopSeverity = severityOrder[a.alerts[0]?.alert.severity ?? "low"] ?? 4
      const bTopSeverity = severityOrder[b.alerts[0]?.alert.severity ?? "low"] ?? 4
      if (aTopSeverity !== bTopSeverity) return aTopSeverity - bTopSeverity
      if (a.alerts.length !== b.alerts.length) return b.alerts.length - a.alerts.length
      return a.patient.demographics.name.localeCompare(b.patient.demographics.name)
    })
  }, [visibleAlerts])

  const recentPatientPatterns = React.useMemo(() => {
    const windowStart = Date.now() - timeWindowHours * 60 * 60 * 1000
    const countsByPatient = new Map<string, { patient: Patient360; count: number }>()

    visibleAlerts.forEach((item) => {
      const createdAt = new Date(item.alert.created_at).getTime()
      if (createdAt < windowStart) return
      const existing = countsByPatient.get(item.patient.patient_id)
      if (!existing) {
        countsByPatient.set(item.patient.patient_id, { patient: item.patient, count: 1 })
        return
      }
      existing.count += 1
    })

    return Array.from(countsByPatient.values())
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [timeWindowHours, visibleAlerts])

  const timelineBuckets = React.useMemo(
    () => buildTimelineBuckets(visibleAlerts, timeWindowHours),
    [visibleAlerts, timeWindowHours],
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
      <div className="flex flex-col items-center justify-center py-24 gap-2">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Failed to load alerts</p>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Active Alerts</h1>
          <p className="text-sm text-muted-foreground">
            {visibleAlerts.length} active alerts across {groupedAlerts.length} patients
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
          <TabsTrigger value="all" className="gap-2">By Patient <Badge variant="secondary" className="h-5 px-1.5">{groupedAlerts.length}</Badge></TabsTrigger>
          <TabsTrigger value="timeline" className="gap-2">Timeline <Badge variant="outline" className="h-5 px-1.5">{timeWindowHours}h</Badge></TabsTrigger>
          <TabsTrigger value="critical" className="gap-2">Critical <Badge variant="destructive" className="h-5 px-1.5">{criticalAlerts.length}</Badge></TabsTrigger>
          <TabsTrigger value="high" className="gap-2">High <Badge className="h-5 px-1.5 bg-warning text-warning-foreground">{highAlerts.length}</Badge></TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="space-y-3">
          {groupedAlerts.length === 0 ? (
            <EmptyState />
          ) : (
            groupedAlerts.map((group) => (
              <PatientAlertGroupCard
                key={group.patient.patient_id}
                group={group}
                alertActions={alertActions}
                onSetAlertAction={(alertId, action) =>
                  setAlertActions((prev) => ({ ...prev, [alertId]: action }))
                }
              />
            ))
          )}
        </TabsContent>
        <TabsContent value="timeline" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Window:</span>
            {[6, 12, 24].map((hours) => (
              <Button
                key={hours}
                variant={timeWindowHours === hours ? "default" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => setTimeWindowHours(hours as 6 | 12 | 24)}
              >
                Last {hours}h
              </Button>
            ))}
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Alert Timeline</p>
                  <p className="text-xs text-muted-foreground">
                    Patterns over the last {timeWindowHours} hours
                  </p>
                </div>
                <Badge variant="outline">
                  {timelineBuckets.reduce((sum, bucket) => sum + bucket.count, 0)} fired
                </Badge>
              </div>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                {timelineBuckets.map((bucket) => (
                  <div key={bucket.label} className="flex flex-col items-center gap-2">
                    <div className="flex h-24 w-full items-end">
                      <div
                        className={cn(
                          "w-full rounded-sm bg-primary/30",
                          bucket.criticalCount > 0 && "bg-destructive/60",
                        )}
                        style={{
                          height: `${Math.max(8, Math.min(100, bucket.count * 28))}%`,
                        }}
                        title={`${bucket.label}: ${bucket.count} alerts`}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{bucket.label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Pattern Highlights</p>
              </div>
              {recentPatientPatterns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No alerts fired in this time window.</p>
              ) : (
                <div className="space-y-2">
                  {recentPatientPatterns.slice(0, 5).map((entry) => (
                    <div
                      key={entry.patient.patient_id}
                      className="flex items-center justify-between rounded-md border border-border p-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{entry.patient.demographics.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.patient.hospital_name}
                        </p>
                      </div>
                      <Badge variant={entry.count >= 3 ? "destructive" : "secondary"}>
                        {entry.count} alerts/{timeWindowHours}h
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="critical" className="space-y-3">
          {criticalAlerts.length === 0 ? (
            <EmptyState message="No critical alerts" />
          ) : (
            criticalAlerts.map((item) => (
              <AlertCard
                key={item.alert.alert_id}
                {...item}
                alertActions={alertActions}
                onSetAlertAction={(alertId, action) =>
                  setAlertActions((prev) => ({ ...prev, [alertId]: action }))
                }
              />
            ))
          )}
        </TabsContent>
        <TabsContent value="high" className="space-y-3">
          {highAlerts.length === 0 ? (
            <EmptyState message="No high severity alerts" />
          ) : (
            highAlerts.map((item) => (
              <AlertCard
                key={item.alert.alert_id}
                {...item}
                alertActions={alertActions}
                onSetAlertAction={(alertId, action) =>
                  setAlertActions((prev) => ({ ...prev, [alertId]: action }))
                }
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function PatientAlertGroupCard({
  group,
  alertActions,
  onSetAlertAction,
}: {
  group: AlertGroup
  alertActions: Record<string, AlertActionState>
  onSetAlertAction: (alertId: string, action: AlertActionState) => void
}) {
  const criticalCount = group.alerts.filter((item) => item.alert.severity === "critical").length
  const highCount = group.alerts.filter((item) => item.alert.severity === "high").length

  return (
    <Card className={cn(criticalCount > 0 && "border-destructive/50", criticalCount === 0 && highCount > 0 && "border-warning/50")}>
      <CardContent className="p-4">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-medium">{group.patient.demographics.name}</h3>
              <Badge variant="outline" className="text-xs">
                {group.patient.demographics.age}y {group.patient.demographics.gender === "female" ? "F" : "M"}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {group.alerts.length} active {group.alerts.length === 1 ? "issue" : "issues"}
              </Badge>
              {criticalCount > 0 && <Badge variant="destructive" className="text-xs">{criticalCount} critical</Badge>}
              {criticalCount === 0 && highCount > 0 && (
                <Badge className="text-xs bg-warning text-warning-foreground">{highCount} high</Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{group.patient.hospital_name}</p>
          </div>
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href={`/patients/${group.patient.patient_id}`}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <div className="space-y-3">
          {group.alerts.map((item) => (
            <AlertCard
              key={item.alert.alert_id}
              {...item}
              compact
              alertActions={alertActions}
              onSetAlertAction={onSetAlertAction}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function AlertCard({
  alert,
  patient,
  compact = false,
  alertActions,
  onSetAlertAction,
}: AlertWithPatient & {
  compact?: boolean
  alertActions: Record<string, AlertActionState>
  onSetAlertAction: (alertId: string, action: AlertActionState) => void
}) {
  const isCritical = alert.severity === "critical"
  const isHigh = alert.severity === "high"
  const resolvedState = resolveAlertState(alert, alertActions[alert.alert_id])

  if (resolvedState === "dismissed") {
    return null
  }

  return (
    <Card className={cn(isCritical && "border-destructive/50", isHigh && "border-warning/50", compact && "border-dashed")}>
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
                  <Badge variant="outline" className="text-xs">
                    {resolvedState === "reviewed" ? "reviewed" : resolvedState === "escalated" ? "escalated" : alert.status}
                  </Badge>
                </div>
                {!compact && (
                  <Link href={`/patients/${patient.patient_id}`} className="text-sm text-muted-foreground hover:text-primary">
                    {patient.demographics.name} ({patient.demographics.age}y) - {patient.hospital_name.split(" ")[0]}
                  </Link>
                )}
              </div>
              {!compact && (
                <Button variant="ghost" size="icon" asChild className="shrink-0">
                  <Link href={`/patients/${patient.patient_id}`}><ChevronRight className="h-4 w-4" /></Link>
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{alert.reasoning}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatRelativeTime(alert.created_at)}</div>
              {alert.suggested_actions?.length > 0 && (
                <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{alert.suggested_actions.length} suggested actions</div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant={resolvedState === "reviewed" ? "default" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => onSetAlertAction(alert.alert_id, "reviewed")}
              >
                Mark reviewed
              </Button>
              <Button
                variant={resolvedState === "escalated" ? "destructive" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => onSetAlertAction(alert.alert_id, "escalated")}
              >
                Escalate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-muted-foreground hover:text-foreground"
                onClick={() => onSetAlertAction(alert.alert_id, "dismissed")}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                Dismiss
              </Button>
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

function buildTimelineBuckets(alerts: AlertWithPatient[], timeWindowHours: number) {
  const now = new Date()
  const buckets = Array.from({ length: timeWindowHours }, (_, i) => {
    const bucketStart = new Date(now.getTime() - (timeWindowHours - i) * 60 * 60 * 1000)
    const bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000)
    return {
      label: bucketStart.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      start: bucketStart,
      end: bucketEnd,
      count: 0,
      criticalCount: 0,
    }
  })

  alerts.forEach((item) => {
    const createdAt = new Date(item.alert.created_at)
    const bucket = buckets.find((candidate) => createdAt >= candidate.start && createdAt < candidate.end)
    if (!bucket) return
    bucket.count += 1
    if (item.alert.severity === "critical") {
      bucket.criticalCount += 1
    }
  })

  return buckets
}

function resolveAlertState(
  alert: Patient360["active_alerts"][number],
  localAction?: AlertActionState,
): AlertActionState | "new" | "acknowledged" | "resolved" {
  if (localAction) return localAction
  if (alert.status === "acknowledged") return "reviewed"
  return alert.status
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
