"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ChevronRight,
  Heart,
  Loader2,
  Thermometer,
  Wind,
  Activity as ActivityIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { fetchAllPatients } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { type Patient360 } from "@/lib/mock-data"

export function VitalsMonitor() {
  const [patients, setPatients] = React.useState<Patient360[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    fetchAllPatients({ limit: 500 })
      .then((data) => { setPatients(data); setError(null) })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

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
        <p className="text-sm text-muted-foreground">Failed to load vitals data</p>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    )
  }

  const patientsWithVitals = patients.filter((p) => p.vitals_summary?.latest)

  const breachCount = patientsWithVitals.filter((p) => {
    const v = p.vitals_summary.latest
    const t = p.personalized_thresholds
    return (
      v.heart_rate < t.heart_rate.low || v.heart_rate > t.heart_rate.high ||
      v.spo2 < t.spo2.low || v.spo2 > t.spo2.high ||
      v.temperature < t.temperature.low || v.temperature > t.temperature.high ||
      v.respiratory_rate < t.respiratory_rate.low || v.respiratory_rate > t.respiratory_rate.high
    )
  }).length

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Vitals Monitor</h1>
        <p className="text-sm text-muted-foreground">
          Real-time vitals overview for all monitored patients
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Patients Monitored</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold">{patientsWithVitals.length}</span>
            <p className="text-xs text-muted-foreground mt-1">With active vitals data</p>
          </CardContent>
        </Card>
        <Card className={breachCount > 0 ? "border-destructive/50 bg-destructive/5" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Threshold Breaches</CardTitle>
          </CardHeader>
          <CardContent>
            <span className={cn("text-3xl font-bold", breachCount > 0 && "text-destructive")}>{breachCount}</span>
            <p className="text-xs text-muted-foreground mt-1">Patients with out-of-range vitals</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Normal Range</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold text-success">{patientsWithVitals.length - breachCount}</span>
            <p className="text-xs text-muted-foreground mt-1">All vitals within thresholds</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Patient Vitals Overview</CardTitle>
          <CardDescription>Current readings with personalized threshold status</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[220px]">Patient</TableHead>
                <TableHead>Heart Rate</TableHead>
                <TableHead>SpO2</TableHead>
                <TableHead>Resp Rate</TableHead>
                <TableHead>Temperature</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patientsWithVitals.map((patient) => (
                <VitalsRow key={patient.patient_id} patient={patient} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function VitalsRow({ patient }: { patient: Patient360 }) {
  const v = patient.vitals_summary.latest
  const t = patient.personalized_thresholds

  const hrStatus = getStatus(v.heart_rate, t.heart_rate.low, t.heart_rate.high)
  const spo2Status = getStatus(v.spo2, t.spo2.low, t.spo2.high)
  const rrStatus = getStatus(v.respiratory_rate, t.respiratory_rate.low, t.respiratory_rate.high)
  const tempStatus = getStatus(v.temperature, t.temperature.low, t.temperature.high)

  const worstStatus = [hrStatus, spo2Status, rrStatus, tempStatus].includes("critical")
    ? "critical"
    : [hrStatus, spo2Status, rrStatus, tempStatus].includes("warning")
      ? "warning"
      : "normal"

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {patient.demographics.given?.[0]}{patient.demographics.family?.[0]}
          </div>
          <div className="min-w-0">
            <span className="font-medium text-sm">{patient.demographics.name}</span>
            <p className="text-xs text-muted-foreground">{patient.hospital_name.split(" ").slice(0, 2).join(" ")}</p>
          </div>
        </div>
      </TableCell>

      <TableCell>
        <VitalCell icon={Heart} value={Math.round(v.heart_rate)} unit="bpm" status={hrStatus} />
      </TableCell>
      <TableCell>
        <VitalCell icon={ActivityIcon} value={v.spo2.toFixed(1)} unit="%" status={spo2Status} />
      </TableCell>
      <TableCell>
        <VitalCell icon={Wind} value={Math.round(v.respiratory_rate)} unit="/min" status={rrStatus} />
      </TableCell>
      <TableCell>
        <VitalCell icon={Thermometer} value={v.temperature.toFixed(1)} unit="°C" status={tempStatus} />
      </TableCell>

      <TableCell>
        <Badge
          variant={worstStatus === "critical" ? "destructive" : worstStatus === "warning" ? "default" : "outline"}
          className={cn(worstStatus === "warning" && "bg-warning text-warning-foreground")}
        >
          {worstStatus === "normal" ? "Normal" : worstStatus === "warning" ? "Warning" : "Critical"}
        </Badge>
      </TableCell>

      <TableCell>
        <Link href={`/patients/${patient.patient_id}`} className="text-muted-foreground hover:text-foreground">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </TableCell>
    </TableRow>
  )
}

function VitalCell({ icon: Icon, value, unit, status }: {
  icon: React.ComponentType<{ className?: string }>
  value: string | number
  unit: string
  status: "normal" | "warning" | "critical"
}) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Icon className={cn("h-3.5 w-3.5",
        status === "normal" && "text-muted-foreground",
        status === "warning" && "text-warning",
        status === "critical" && "text-destructive",
      )} />
      <span className={cn("tabular-nums font-medium",
        status === "warning" && "text-warning",
        status === "critical" && "text-destructive",
      )}>{value}</span>
      <span className="text-muted-foreground text-xs">{unit}</span>
    </div>
  )
}

function getStatus(value: number, low: number, high: number): "normal" | "warning" | "critical" {
  if (value < low * 0.9 || value > high * 1.1) return "critical"
  if (value < low || value > high) return "warning"
  return "normal"
}
