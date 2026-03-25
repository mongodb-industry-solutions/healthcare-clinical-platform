"use client"

import * as React from "react"
import Link from "next/link"
import { Calendar, ChevronRight, ClipboardList, AlertTriangle } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { mockPatients } from "@/lib/mock-data"

type CareGapWithPatient = {
  gap: typeof mockPatients[0]["care_gaps"][0]
  patient: typeof mockPatients[0]
}

export function CareGapsView() {
  // Collect all care gaps with patient context
  const allGaps: CareGapWithPatient[] = React.useMemo(() => {
    const gaps: CareGapWithPatient[] = []
    mockPatients.forEach((patient) => {
      patient.care_gaps.forEach((gap) => {
        gaps.push({ gap, patient })
      })
    })
    // Sort by days overdue (most overdue first), then by priority
    return gaps.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
      const overdueDiff = b.gap.days_overdue - a.gap.days_overdue
      if (overdueDiff !== 0) return overdueDiff
      return priorityOrder[a.gap.priority] - priorityOrder[b.gap.priority]
    })
  }, [])

  const overdueGaps = allGaps.filter((g) => g.gap.days_overdue > 0)
  const upcomingGaps = allGaps.filter((g) => g.gap.days_overdue === 0)

  // Group by HEDIS measure
  const measureCounts = React.useMemo(() => {
    const counts: Record<string, number> = {}
    allGaps.forEach(({ gap }) => {
      counts[gap.hedis_measure] = (counts[gap.hedis_measure] || 0) + 1
    })
    return counts
  }, [allGaps])

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Care Gaps</h1>
        <p className="text-sm text-muted-foreground">
          HEDIS quality measures and preventive care tracking
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Gaps</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold">{allGaps.length}</span>
          </CardContent>
        </Card>
        <Card className="border-destructive/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold text-destructive">{overdueGaps.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Patients Affected</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold">
              {new Set(allGaps.map(g => g.patient.patient_id)).size}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Measures Tracked</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold">{Object.keys(measureCounts).length}</span>
          </CardContent>
        </Card>
      </div>

      {/* HEDIS Measures Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">HEDIS Measures</CardTitle>
          <CardDescription>Open care gaps by quality measure</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {Object.entries(measureCounts).map(([measure, count]) => (
              <div 
                key={measure}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <ClipboardList className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium">{measure}</div>
                    <div className="text-xs text-muted-foreground">
                      {getMeasureName(measure)}
                    </div>
                  </div>
                </div>
                <Badge variant="secondary">{count}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Care Gaps Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">All Care Gaps</CardTitle>
          <CardDescription>Prioritized by overdue status and severity</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[200px]">Patient</TableHead>
                <TableHead>Measure</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[120px]">Due Date</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allGaps.map(({ gap, patient }, index) => (
                <TableRow key={`${patient.patient_id}-${gap.hedis_measure}-${index}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {patient.demographics.given[0]}{patient.demographics.family[0]}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{patient.demographics.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {patient.demographics.age}y
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{gap.hedis_measure}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{gap.measure_name}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      {new Date(gap.due_by).toLocaleDateString()}
                    </div>
                  </TableCell>
                  <TableCell>
                    {gap.days_overdue > 0 ? (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {gap.days_overdue}d overdue
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Due soon
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" asChild className="h-8 w-8">
                      <Link href={`/patients/${patient.patient_id}`}>
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function getMeasureName(measure: string): string {
  const names: Record<string, string> = {
    "CDC-HBA": "HbA1c Testing",
    "KED": "Kidney Evaluation",
    "CBP": "Blood Pressure Control",
    "SPD": "Statin Therapy",
    "EED": "Eye Exam",
  }
  return names[measure] || measure
}
