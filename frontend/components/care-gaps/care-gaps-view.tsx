"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Filter,
  Loader2,
  Send,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useDemo } from "@/lib/demo-context"
import { fetchAllPatients } from "@/lib/api"
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
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type Patient360 } from "@/lib/mock-data"
import {
  getCareGapMeasureDashboardLabel,
  getCareGapMeasureDescription,
  getEffectiveGapState,
} from "@/lib/care-gap-measures"

type CareGapWithPatient = {
  gap: Patient360["care_gaps"][number]
  patient: Patient360
}

type ScheduledAction = {
  gapKey: string
  action: "scheduled" | "ordered"
}

export function CareGapsView() {
  const { dataVersion } = useDemo()
  const searchParams = useSearchParams()
  const [patients, setPatients] = React.useState<Patient360[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [scheduledActions, setScheduledActions] = React.useState<Record<string, ScheduledAction>>({})
  const [dialogTarget, setDialogTarget] = React.useState<{ item: CareGapWithPatient; action: "schedule" | "order" } | null>(null)
  const dashboardSource = searchParams.get("source") === "dashboard"
  const focusedMeasures = React.useMemo(
    () =>
      (searchParams.get("measures") ?? "")
        .split(",")
        .map((measure) => measure.trim())
        .filter(Boolean),
    [searchParams],
  )

  React.useEffect(() => {
    setLoading(true)
    fetchAllPatients({ limit: 500 })
      .then((data) => {
        setPatients(data)
        setError(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [dataVersion])

  const allGaps: CareGapWithPatient[] = React.useMemo(() => {
    const gaps: CareGapWithPatient[] = []
    patients.forEach((patient) => {
      patient.care_gaps.forEach((gap) => {
        gaps.push({ gap, patient })
      })
    })
    return gaps.sort((a, b) => {
      const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
      const overdueDiff = b.gap.days_overdue - a.gap.days_overdue
      if (overdueDiff !== 0) return overdueDiff
      return (priorityOrder[a.gap.priority] ?? 4) - (priorityOrder[b.gap.priority] ?? 4)
    })
  }, [patients])

  const openGaps = React.useMemo(
    () => allGaps.filter((g) => g.gap.status === "open"),
    [allGaps],
  )
  const focusedOpenGaps = React.useMemo(
    () =>
      focusedMeasures.length > 0
        ? openGaps.filter((item) => focusedMeasures.includes(item.gap.hedis_measure))
        : openGaps,
    [focusedMeasures, openGaps],
  )
  const focusedMeasureLabels = React.useMemo(
    () => focusedMeasures.map((measure) => getCareGapMeasureDashboardLabel(measure)),
    [focusedMeasures],
  )

  const overdueGaps = React.useMemo(
    () => openGaps.filter((g) => g.gap.days_overdue > 0),
    [openGaps],
  )

  const dueSoonGaps = React.useMemo(
    () => openGaps.filter((g) => g.gap.days_overdue <= 0),
    [openGaps],
  )

  const closedGaps = React.useMemo(
    () => allGaps.filter((g) => g.gap.status === "closed"),
    [allGaps],
  )

  const complianceStats = React.useMemo(
    () => computeComplianceStats(patients),
    [patients],
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
        <p className="text-sm text-muted-foreground">Failed to load care gaps</p>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    )
  }

  function gapKey(item: CareGapWithPatient) {
    return `${item.patient.patient_id}::${item.gap.hedis_measure}`
  }

  function handleConfirmAction() {
    if (!dialogTarget) return
    const key = gapKey(dialogTarget.item)
    setScheduledActions((prev) => ({
      ...prev,
      [key]: { gapKey: key, action: dialogTarget.action === "schedule" ? "scheduled" : "ordered" },
    }))
    setDialogTarget(null)
  }

  const scheduledCount = Object.keys(scheduledActions).length

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Care Gaps</h1>
        <p className="text-sm text-muted-foreground">
          HEDIS quality measures — track compliance, schedule orders, close gaps
        </p>
      </div>

      {dashboardSource && (
        <Card className="border-border/60 bg-white shadow-sm">
          <CardContent className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ClipboardList className="h-4 w-4 text-primary" />
                  <span className="whitespace-nowrap">Handoff from Clinical Quality Operations</span>
                </div>
                {focusedMeasureLabels.slice(0, 3).map((label) => (
                  <Badge key={label} variant="secondary" className="border border-[#CFF5DD] bg-[#F2FFF8] text-[#0F5A3C]">
                    {label}
                  </Badge>
                ))}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {focusedMeasureLabels.length > 0
                  ? `This view continues the priorities surfaced on the dashboard. ${focusedOpenGaps.length} open gap${focusedOpenGaps.length === 1 ? "" : "s"} match the current focus.`
                  : "Continue working the open care gaps that were elevated on the dashboard."}
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="w-full lg:w-auto lg:shrink-0">
              <Link href="/">Return to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ---- Stats row ---- */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open Gaps</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold">{openGaps.length}</span>
            <p className="text-xs text-muted-foreground mt-1">
              {allGaps.length} total across {new Set(allGaps.map((g) => g.patient.patient_id)).size} patients
            </p>
          </CardContent>
        </Card>
        <Card className={cn(overdueGaps.length > 0 && "border-destructive/50")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
          </CardHeader>
          <CardContent>
            <span className={cn("text-3xl font-bold", overdueGaps.length > 0 && "text-destructive")}>{overdueGaps.length}</span>
            {overdueGaps.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Avg {Math.round(overdueGaps.reduce((s, g) => s + g.gap.days_overdue, 0) / overdueGaps.length)}d overdue
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Due Soon</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold text-warning">{dueSoonGaps.length}</span>
          </CardContent>
        </Card>
        <Card className={cn(closedGaps.length > 0 && "border-green-500/30")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Compliant</CardTitle>
          </CardHeader>
          <CardContent>
            <span className={cn("text-3xl font-bold", closedGaps.length > 0 && "text-green-600 dark:text-green-400")}>
              {closedGaps.length}
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              Measures met on schedule
            </p>
          </CardContent>
        </Card>
        <Card className={cn(scheduledCount > 0 && "border-primary/50")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Scheduled / Ordered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className={cn("text-3xl font-bold", scheduledCount > 0 && "text-primary")}>
              {scheduledCount}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* ---- Compliance scorecard ---- */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium">HEDIS Compliance</CardTitle>
              <CardDescription>
                Population-level compliance across all tracked measures
              </CardDescription>
            </div>
            <div className="text-right">
              <span className="text-3xl font-bold tabular-nums">
                {complianceStats.overall}%
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">overall</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Progress value={complianceStats.overall} className="h-2.5 mb-5" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {complianceStats.perMeasure.map((entry) => (
              <div key={entry.measure} className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">{entry.measure}</span>
                  </div>
                  <span
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      entry.rate >= 80 && "text-success",
                      entry.rate >= 50 && entry.rate < 80 && "text-warning",
                      entry.rate < 50 && "text-destructive",
                    )}
                  >
                    {entry.rate}%
                  </span>
                </div>
                <Progress
                  value={entry.rate}
                  className={cn(
                    "h-1.5",
                    entry.rate >= 80 && "[&>div]:bg-success",
                    entry.rate >= 50 && entry.rate < 80 && "[&>div]:bg-warning",
                    entry.rate < 50 && "[&>div]:bg-destructive",
                  )}
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {getCareGapMeasureDescription(entry.measure, entry.measureName)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {entry.compliant}/{entry.eligible} patients compliant
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ---- Urgency-filtered table ---- */}
      <Tabs defaultValue={overdueGaps.length > 0 ? "overdue" : "all"} className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="overdue" className="gap-2">
              <Filter className="h-3.5 w-3.5" />
              Overdue
              <Badge variant="destructive" className="h-5 px-1.5">
                {overdueGaps.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="due-soon" className="gap-2">
              Due Soon
              <Badge variant="secondary" className="h-5 px-1.5">
                {dueSoonGaps.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="compliant" className="gap-2">
              Compliant
              <Badge variant="outline" className="h-5 px-1.5 border-green-500/50 text-green-600 dark:text-green-400">
                {closedGaps.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="all" className="gap-2">
              All
              <Badge variant="outline" className="h-5 px-1.5">
                {allGaps.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overdue">
          <GapTable
            items={overdueGaps}
            scheduledActions={scheduledActions}
            onAction={setDialogTarget}
            gapKeyFn={gapKey}
          />
        </TabsContent>
        <TabsContent value="due-soon">
          <GapTable
            items={dueSoonGaps}
            scheduledActions={scheduledActions}
            onAction={setDialogTarget}
            gapKeyFn={gapKey}
          />
        </TabsContent>
        <TabsContent value="compliant">
          <GapTable
            items={closedGaps}
            scheduledActions={scheduledActions}
            onAction={setDialogTarget}
            gapKeyFn={gapKey}
          />
        </TabsContent>
        <TabsContent value="all">
          <GapTable
            items={allGaps}
            scheduledActions={scheduledActions}
            onAction={setDialogTarget}
            gapKeyFn={gapKey}
          />
        </TabsContent>
      </Tabs>

      {/* ---- Confirmation dialog ---- */}
      <Dialog open={dialogTarget !== null} onOpenChange={(open) => !open && setDialogTarget(null)}>
        {dialogTarget && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {dialogTarget.action === "schedule" ? "Schedule Appointment" : "Place Order"}
              </DialogTitle>
              <DialogDescription>
                {dialogTarget.action === "schedule"
                  ? `Schedule a follow-up for ${dialogTarget.item.patient.demographics.name} to close the ${dialogTarget.item.gap.hedis_measure} care gap.`
                  : `Place a lab/imaging order for ${dialogTarget.item.patient.demographics.name} to address the ${dialogTarget.item.gap.measure_name} gap.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="rounded-md border p-3 text-sm">
                <p>
                  <span className="font-medium">Patient:</span>{" "}
                  {dialogTarget.item.patient.demographics.name} ({dialogTarget.item.patient.demographics.age}y)
                </p>
                <p>
                  <span className="font-medium">Measure:</span>{" "}
                  {dialogTarget.item.gap.hedis_measure} — {dialogTarget.item.gap.measure_name}
                </p>
                <p>
                  <span className="font-medium">Due:</span>{" "}
                  {formatDueDate(dialogTarget.item.gap.due_by)}
                  {dialogTarget.item.gap.days_overdue > 0 && (
                    <span className="ml-1 text-destructive">
                      ({dialogTarget.item.gap.days_overdue}d overdue)
                    </span>
                  )}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                In a production system this would integrate with your EHR scheduling or CPOE module.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmAction}>
                {dialogTarget.action === "schedule" ? (
                  <>
                    <CalendarPlus className="mr-1.5 h-4 w-4" />
                    Confirm Schedule
                  </>
                ) : (
                  <>
                    <Send className="mr-1.5 h-4 w-4" />
                    Place Order
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Gap table                                                          */
/* ------------------------------------------------------------------ */

function GapTable({
  items,
  scheduledActions,
  onAction,
  gapKeyFn,
}: {
  items: CareGapWithPatient[]
  scheduledActions: Record<string, ScheduledAction>
  onAction: (target: { item: CareGapWithPatient; action: "schedule" | "order" }) => void
  gapKeyFn: (item: CareGapWithPatient) => string
}) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <CheckCircle2 className="h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground mt-4">No care gaps in this category</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[200px]">Patient</TableHead>
              <TableHead>Measure</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[120px]">Due Date</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[210px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const key = gapKeyFn(item)
              const action = scheduledActions[key]

              return (
                <TableRow key={`${key}-${index}`}>
                  <TableCell>
                    <Link
                      href={`/patients/${item.patient.patient_id}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {item.patient.demographics.given?.[0]}
                        {item.patient.demographics.family?.[0]}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{item.patient.demographics.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.patient.demographics.age}y
                        </div>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.gap.hedis_measure}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{item.gap.measure_name}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      {formatDueDate(item.gap.due_by)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {action ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-primary/40 text-primary"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        {action.action === "scheduled" ? "Scheduled" : "Ordered"}
                      </Badge>
                    ) : getEffectiveGapState(item.gap) === "closed_uncontrolled" ? (
                      <Badge variant="outline" className="gap-1 border-amber-400 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        Closed — flagged
                      </Badge>
                    ) : item.gap.status === "closed" ? (
                      <Badge variant="outline" className="gap-1 border-green-500/40 text-green-600 dark:text-green-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Compliant
                      </Badge>
                    ) : item.gap.days_overdue > 0 ? (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {item.gap.days_overdue}d overdue
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Due soon
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {action ? (
                      <span className="text-xs text-muted-foreground">Action taken</span>
                    ) : item.gap.status === "closed" ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {getEffectiveGapState(item.gap) === "closed_uncontrolled"
                            ? "Review result"
                            : "Up to date"}
                        </span>
                        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
                          <Link href={`/patients/${item.patient.patient_id}`}>
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1"
                          onClick={() => onAction({ item, action: "schedule" })}
                        >
                          <CalendarPlus className="h-3.5 w-3.5" />
                          Schedule
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1"
                          onClick={() => onAction({ item, action: "order" })}
                        >
                          <Send className="h-3.5 w-3.5" />
                          Order
                        </Button>
                        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
                          <Link href={`/patients/${item.patient.patient_id}`}>
                            <ChevronRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDueDate(dueBy: string | null | undefined): string {
  if (!dueBy) return "Not scheduled"
  const d = new Date(dueBy)
  if (isNaN(d.getTime())) return "Not scheduled"
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

/* ------------------------------------------------------------------ */
/*  Compliance calculation                                             */
/* ------------------------------------------------------------------ */

type MeasureCompliance = {
  measure: string
  measureName: string
  eligible: number
  compliant: number
  rate: number
}

function computeComplianceStats(patients: Patient360[]): {
  overall: number
  perMeasure: MeasureCompliance[]
} {
  const measureMap = new Map<string, { eligible: number; compliant: number; name: string }>()

  patients.forEach((patient) => {
    const relevantMeasures = new Set<string>()

    patient.care_gaps.forEach((gap) => {
      relevantMeasures.add(gap.hedis_measure)
      const entry = measureMap.get(gap.hedis_measure) ?? {
        eligible: 0,
        compliant: 0,
        name: gap.measure_name,
      }
      entry.eligible += 1
      if (gap.status === "closed") {
        entry.compliant += 1
      }
      measureMap.set(gap.hedis_measure, entry)
    })
  })

  const perMeasure: MeasureCompliance[] = Array.from(measureMap.entries()).map(
    ([measure, data]) => ({
      measure,
      measureName: data.name,
      eligible: data.eligible,
      compliant: data.compliant,
      rate: data.eligible > 0 ? Math.round((data.compliant / data.eligible) * 100) : 100,
    }),
  )

  const totalEligible = perMeasure.reduce((sum, entry) => sum + entry.eligible, 0)
  const totalCompliant = perMeasure.reduce((sum, entry) => sum + entry.compliant, 0)
  const overall = totalEligible > 0 ? Math.round((totalCompliant / totalEligible) * 100) : 100

  return { overall, perMeasure }
}
