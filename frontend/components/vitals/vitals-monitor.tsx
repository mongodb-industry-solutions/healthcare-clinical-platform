"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ChevronRight,
  Heart,
  Loader2,
  Pause,
  Play,
  Radio,
  Thermometer,
  Wind,
  Activity as ActivityIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { fetchAllPatients } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { type Patient360 } from "@/lib/mock-data"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

interface LiveReading {
  patient_id: string
  heart_rate: number
  respiratory_rate: number
  temperature: number
  spo2: number
  activity_level: number
  pattern: string
  event: string | null
  timestamp: string
}

export function VitalsMonitor() {
  const [patients, setPatients] = React.useState<Patient360[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [interval, setInterval_] = React.useState(5)
  const [pattern, setPattern] = React.useState("deteriorating")
  const [streaming, setStreaming] = React.useState(false)
  const [liveReadings, setLiveReadings] = React.useState<Map<string, LiveReading>>(new Map())
  const [tickCount, setTickCount] = React.useState(0)

  const eventSourceRef = React.useRef<EventSource | null>(null)

  React.useEffect(() => {
    fetchAllPatients({ limit: 500 })
      .then((data) => { setPatients(data); setError(null) })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const togglePatient = React.useCallback((patientId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(patientId)) next.delete(patientId)
      else next.add(patientId)
      return next
    })
  }, [])

  const selectAll = React.useCallback(() => {
    setSelectedIds(new Set(patients.map((p) => p.patient_id)))
  }, [patients])

  const clearSelection = React.useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const startStreaming = React.useCallback(() => {
    if (selectedIds.size === 0) return

    const ids = Array.from(selectedIds).join(",")
    const url = `${API_URL}/synthetic/vitals/stream?patient_ids=${encodeURIComponent(ids)}&interval_seconds=${interval}&pattern=${pattern}`

    const es = new EventSource(url)
    eventSourceRef.current = es
    setTickCount(0)

    es.addEventListener("connected", () => {
      setStreaming(true)
    })

    es.addEventListener("vitals", (e) => {
      try {
        const data = JSON.parse(e.data)
        const readings: LiveReading[] = data.readings || []
        setLiveReadings((prev) => {
          const next = new Map(prev)
          for (const r of readings) {
            next.set(r.patient_id, r)
          }
          return next
        })
        setTickCount((c) => c + 1)
      } catch { /* ignore parse errors */ }
    })

    es.addEventListener("alert", (e) => {
      try {
        const data = JSON.parse(e.data)
        const name = data.patient_name || data.patient_id
        const alerts = data.active_alerts || []
        for (const alert of alerts) {
          if (alert.severity === "critical" || alert.severity === "high") {
            toast.error(`${name} — ${alert.title}`, {
              description: alert.reasoning?.split(".")[0] || alert.severity,
              duration: 8000,
            })
          }
        }
      } catch { /* ignore parse errors */ }
    })

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStreaming(false)
        eventSourceRef.current = null
      }
    }

    setStreaming(true)
  }, [selectedIds, interval, pattern])

  const stopStreaming = React.useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    setStreaming(false)
  }, [])

  React.useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
    }
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
        <p className="text-sm text-muted-foreground">Failed to load patients</p>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    )
  }

  const monitoredPatients = patients.filter((p) => selectedIds.has(p.patient_id))

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Vitals Monitor</h1>
          {streaming && (
            <Badge className="gap-1.5 bg-success text-white animate-pulse">
              <Radio className="h-3 w-3" />
              LIVE
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Real-time vitals simulation with CDS alert detection
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Monitoring Controls</CardTitle>
          <CardDescription>
            Select patients, choose a simulation pattern, and start live monitoring
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={selectAll} disabled={streaming}>
                Select All ({patients.length})
              </Button>
              <Button variant="outline" size="sm" onClick={clearSelection} disabled={streaming}>
                Clear
              </Button>
              <span className="flex items-center text-sm text-muted-foreground ml-2">
                {selectedIds.size} patient{selectedIds.size !== 1 ? "s" : ""} selected
              </span>
            </div>

            <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto">
              {patients.map((p) => (
                <Button
                  key={p.patient_id}
                  variant={selectedIds.has(p.patient_id) ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => togglePatient(p.patient_id)}
                  disabled={streaming}
                >
                  {p.demographics.name}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Pattern:</span>
                <Select value={pattern} onValueChange={setPattern} disabled={streaming}>
                  <SelectTrigger className="w-[160px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="deteriorating">Deteriorating</SelectItem>
                    <SelectItem value="acute">Acute</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Interval:</span>
                <Select value={String(interval)} onValueChange={(v) => setInterval_(Number(v))} disabled={streaming}>
                  <SelectTrigger className="w-[100px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3s</SelectItem>
                    <SelectItem value="5">5s</SelectItem>
                    <SelectItem value="10">10s</SelectItem>
                    <SelectItem value="15">15s</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {streaming && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Tick #{tickCount}
                  </span>
                )}
                {streaming ? (
                  <Button variant="destructive" size="sm" onClick={stopStreaming} className="gap-1.5">
                    <Pause className="h-3.5 w-3.5" />
                    Stop Monitoring
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={startStreaming}
                    disabled={selectedIds.size === 0}
                    className="gap-1.5"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Start Monitoring
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      {streaming && monitoredPatients.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            title="Patients Monitored"
            value={monitoredPatients.length}
            description="Receiving live vitals"
          />
          <SummaryCard
            title="Threshold Breaches"
            value={countBreaches(monitoredPatients, liveReadings)}
            description="Patients with out-of-range vitals"
            variant={countBreaches(monitoredPatients, liveReadings) > 0 ? "critical" : "default"}
          />
          <SummaryCard
            title="Readings Generated"
            value={tickCount * monitoredPatients.length}
            description={`${tickCount} ticks × ${monitoredPatients.length} patients`}
          />
        </div>
      )}

      {/* Live vitals table */}
      {monitoredPatients.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">
              {streaming ? "Live Patient Vitals" : "Selected Patients"}
            </CardTitle>
            <CardDescription>
              {streaming
                ? `Updating every ${interval}s — pattern: ${pattern}`
                : "Start monitoring to see live vitals updates"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[200px]">Patient</TableHead>
                  <TableHead>Heart Rate</TableHead>
                  <TableHead>SpO2</TableHead>
                  <TableHead>Resp Rate</TableHead>
                  <TableHead>Temperature</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monitoredPatients.map((patient) => (
                  <LiveVitalsRow
                    key={patient.patient_id}
                    patient={patient}
                    liveReading={liveReadings.get(patient.patient_id)}
                    streaming={streaming}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {monitoredPatients.length === 0 && !streaming && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Select patients above to begin monitoring</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SummaryCard({ title, value, description, variant = "default" }: {
  title: string; value: number; description: string; variant?: "default" | "critical"
}) {
  return (
    <Card className={cn(variant === "critical" && value > 0 && "border-destructive/50 bg-destructive/5")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <span className={cn("text-3xl font-bold", variant === "critical" && value > 0 && "text-destructive")}>
          {value}
        </span>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  )
}

function LiveVitalsRow({ patient, liveReading, streaming }: {
  patient: Patient360; liveReading?: LiveReading; streaming: boolean
}) {
  const v = liveReading || (patient.vitals_summary?.latest as LiveReading | undefined)
  const t = patient.personalized_thresholds

  if (!v || !t) {
    return (
      <TableRow>
        <TableCell>
          <span className="font-medium text-sm">{patient.demographics.name}</span>
        </TableCell>
        <TableCell colSpan={7}>
          <span className="text-xs text-muted-foreground">
            {streaming ? "Waiting for first reading..." : "No vitals data"}
          </span>
        </TableCell>
      </TableRow>
    )
  }

  const hrStatus = getStatus(v.heart_rate, t.heart_rate.low, t.heart_rate.high)
  const spo2Status = getStatus(v.spo2, t.spo2.low, t.spo2.high)
  const rrStatus = getStatus(v.respiratory_rate, t.respiratory_rate.low, t.respiratory_rate.high)
  const tempStatus = getStatus(v.temperature, t.temperature.low, t.temperature.high)

  const statuses = [hrStatus, spo2Status, rrStatus, tempStatus]
  const worstStatus = statuses.includes("critical")
    ? "critical" : statuses.includes("warning")
      ? "warning" : "normal"

  return (
    <TableRow className={cn(
      streaming && "transition-colors duration-500",
      worstStatus === "critical" && streaming && "bg-destructive/5",
    )}>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {patient.demographics.given?.[0]}{patient.demographics.family?.[0]}
          </div>
          <div className="min-w-0">
            <span className="font-medium text-sm">{patient.demographics.name}</span>
            <p className="text-xs text-muted-foreground">{patient.profile_type}</p>
          </div>
        </div>
      </TableCell>

      <TableCell>
        <AnimatedVital icon={Heart} value={Math.round(v.heart_rate)} unit="bpm" status={hrStatus} streaming={streaming} />
      </TableCell>
      <TableCell>
        <AnimatedVital icon={ActivityIcon} value={Number(v.spo2.toFixed(1))} unit="%" status={spo2Status} streaming={streaming} />
      </TableCell>
      <TableCell>
        <AnimatedVital icon={Wind} value={Math.round(v.respiratory_rate)} unit="/min" status={rrStatus} streaming={streaming} />
      </TableCell>
      <TableCell>
        <AnimatedVital icon={Thermometer} value={Number(v.temperature.toFixed(1))} unit="°C" status={tempStatus} streaming={streaming} />
      </TableCell>

      <TableCell>
        {liveReading?.event ? (
          <Badge variant="destructive" className="text-xs">{liveReading.event}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
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

function AnimatedVital({ icon: Icon, value, unit, status, streaming }: {
  icon: React.ComponentType<{ className?: string }>
  value: number; unit: string
  status: "normal" | "warning" | "critical"
  streaming: boolean
}) {
  return (
    <div className={cn(
      "flex items-center gap-1.5 text-sm",
      streaming && "transition-all duration-700",
    )}>
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

function countBreaches(
  patients: Patient360[],
  liveReadings: Map<string, LiveReading>,
): number {
  let count = 0
  for (const p of patients) {
    const v = liveReadings.get(p.patient_id)
    const t = p.personalized_thresholds
    if (!v || !t) continue
    if (
      v.heart_rate < t.heart_rate.low || v.heart_rate > t.heart_rate.high ||
      v.spo2 < t.spo2.low || v.spo2 > t.spo2.high ||
      v.temperature < t.temperature.low || v.temperature > t.temperature.high ||
      v.respiratory_rate < t.respiratory_rate.low || v.respiratory_rate > t.respiratory_rate.high
    ) {
      count++
    }
  }
  return count
}
