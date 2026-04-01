"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ChevronRight,
  Heart,
  Loader2,
  Radio,
  Search,
  Thermometer,
  Wind,
  X,
  Zap,
  TrendingDown,
  Activity as ActivityIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { useDemo } from "@/lib/demo-context"
import { useSimulation, type LiveReading } from "@/lib/simulation-context"
import { fetchAllPatients } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { type Patient360 } from "@/lib/mock-data"

const MAX_WATCHLIST = 20

type SmartFilter = "critical" | "deteriorating" | "high-alerts"

const SMART_FILTERS: { key: SmartFilter; label: string; icon: React.ReactNode; description: string }[] = [
  { key: "critical", label: "Critical patients", icon: <AlertTriangle className="h-3.5 w-3.5" />, description: "Active critical alerts" },
  { key: "deteriorating", label: "Deteriorating vitals", icon: <TrendingDown className="h-3.5 w-3.5" />, description: "Worsening trends in past 24h" },
  { key: "high-alerts", label: "High-priority alerts", icon: <Zap className="h-3.5 w-3.5" />, description: "Active high-severity alerts" },
]

function applySmartFilter(patients: Patient360[], filter: SmartFilter): Patient360[] {
  switch (filter) {
    case "critical":
      return patients.filter((p) => p.active_alerts.some((a) => a.severity === "critical"))
    case "deteriorating":
      return patients.filter((p) => {
        const t = p.vitals_summary.trend_24h
        return t.spo2 === "decreasing" || t.heart_rate === "increasing" || t.respiratory_rate === "increasing"
      })
    case "high-alerts":
      return patients.filter((p) => p.active_alerts.some((a) => a.severity === "high"))
    default:
      return []
  }
}

export function VitalsMonitor() {
  const { dataVersion } = useDemo()
  const { isRunning, tickCount, liveReadings: globalReadings } = useSimulation()
  const [patients, setPatients] = React.useState<Patient360[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [watchlistIds, setWatchlistIds] = React.useState<Set<string>>(new Set())
  const [searchOpen, setSearchOpen] = React.useState(false)

  React.useEffect(() => {
    setLoading(true)
    fetchAllPatients({ limit: 500 })
      .then((data) => { setPatients(data); setError(null) })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [dataVersion])

  // Auto-populate watchlist with critical/deteriorating patients on first load
  React.useEffect(() => {
    if (patients.length > 0 && watchlistIds.size === 0) {
      const critical = patients.filter((p) => p.active_alerts.some((a) => a.severity === "critical" || a.severity === "high"))
      if (critical.length > 0) {
        setWatchlistIds(new Set(critical.slice(0, MAX_WATCHLIST).map((p) => p.patient_id)))
      }
    }
  }, [patients]) // eslint-disable-line react-hooks/exhaustive-deps

  const addToWatchlist = React.useCallback((patientId: string) => {
    setWatchlistIds((prev) => {
      if (prev.size >= MAX_WATCHLIST) {
        toast.warning(`Watchlist is limited to ${MAX_WATCHLIST} patients`)
        return prev
      }
      const next = new Set(prev)
      next.add(patientId)
      return next
    })
  }, [])

  const removeFromWatchlist = React.useCallback((patientId: string) => {
    setWatchlistIds((prev) => {
      const next = new Set(prev)
      next.delete(patientId)
      return next
    })
  }, [])

  const applyFilter = React.useCallback((filter: SmartFilter) => {
    const matched = applySmartFilter(patients, filter)
    if (matched.length === 0) {
      toast.info("No patients match this filter")
      return
    }
    setWatchlistIds((prev) => {
      const next = new Set(prev)
      let added = 0
      for (const p of matched) {
        if (next.size >= MAX_WATCHLIST) break
        if (!next.has(p.patient_id)) {
          next.add(p.patient_id)
          added++
        }
      }
      if (added > 0) toast.success(`Added ${added} patient${added > 1 ? "s" : ""} to watchlist`)
      else toast.info("All matching patients are already on the watchlist")
      return next
    })
  }, [patients])

  const clearWatchlist = React.useCallback(() => {
    setWatchlistIds(new Set())
  }, [])

  const watchlistPatients = React.useMemo(
    () => patients.filter((p) => watchlistIds.has(p.patient_id)),
    [patients, watchlistIds],
  )

  const availablePatients = React.useMemo(
    () => patients.filter((p) => !watchlistIds.has(p.patient_id)),
    [patients, watchlistIds],
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
        <p className="text-sm text-muted-foreground">Failed to load patients</p>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Vitals Monitor</h1>
            {isRunning && (
              <Badge className="gap-1.5 bg-success text-white animate-pulse">
                <Radio className="h-3 w-3" />
                LIVE
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Real-time vitals monitoring with CDS alert detection
          </p>
        </div>
        {isRunning && (
          <span className="text-xs text-muted-foreground tabular-nums">
            Tick #{tickCount}
          </span>
        )}
      </div>

      {/* Watchlist bar + controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium">Watchlist</CardTitle>
              <CardDescription>
                {watchlistIds.size === 0
                  ? "Add patients to begin monitoring"
                  : `${watchlistIds.size} patient${watchlistIds.size !== 1 ? "s" : ""} — max ${MAX_WATCHLIST}`
                }
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {watchlistIds.size > 0 && (
                <Button variant="ghost" size="sm" onClick={clearWatchlist} className="text-xs text-muted-foreground">
                  Clear all
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Add patients row: search + smart filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Search className="h-3.5 w-3.5" />
                  Add patient
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search by name, MRN, or hospital..." />
                  <CommandList>
                    <CommandEmpty>No patients found.</CommandEmpty>
                    <CommandGroup heading="Available patients">
                      {availablePatients.map((p) => (
                        <CommandItem
                          key={p.patient_id}
                          value={`${p.demographics.name} ${p.mrn} ${p.hospital_name}`}
                          onSelect={() => {
                            addToWatchlist(p.patient_id)
                            setSearchOpen(false)
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                              {p.demographics.given[0]}{p.demographics.family[0]}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm">{p.demographics.name}</p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {p.mrn} · {p.hospital_name}
                              </p>
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <span className="text-xs text-muted-foreground">or quick-add:</span>

            {SMART_FILTERS.map((sf) => (
              <TooltipProvider key={sf.key} delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => applyFilter(sf.key)}
                    >
                      {sf.icon}
                      {sf.label}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">{sf.description}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>

          {/* Watchlist chips */}
          {watchlistIds.size > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {watchlistPatients.map((p) => {
                const reading = globalReadings.get(p.patient_id)
                const status = reading ? getWorstStatus(p, reading) : null
                return (
                  <div
                    key={p.patient_id}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                      status === "critical" && "border-destructive/50 bg-destructive/10",
                      status === "warning" && "border-warning/50 bg-warning/10",
                      !status && "border-border bg-muted/50",
                    )}
                  >
                    <span className={cn(
                      "h-2 w-2 rounded-full",
                      status === "critical" && "bg-destructive animate-pulse",
                      status === "warning" && "bg-warning",
                      status === "normal" && "bg-emerald-500",
                      !status && "bg-muted-foreground/40",
                    )} />
                    <span className="font-medium">{p.demographics.given[0]}. {p.demographics.family}</span>
                    <button
                      onClick={() => removeFromWatchlist(p.patient_id)}
                      className="ml-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary stats */}
      {isRunning && watchlistPatients.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard title="Patients Monitored" value={watchlistPatients.length} description="Receiving live vitals" />
          <SummaryCard
            title="Threshold Breaches"
            value={countBreaches(watchlistPatients, globalReadings)}
            description="Patients with out-of-range vitals"
            variant={countBreaches(watchlistPatients, globalReadings) > 0 ? "critical" : "default"}
          />
          <SummaryCard
            title="Readings Generated"
            value={tickCount * watchlistPatients.length}
            description={`${tickCount} ticks × ${watchlistPatients.length} patients`}
          />
        </div>
      )}

      {/* Vitals card grid */}
      {watchlistPatients.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {watchlistPatients.map((patient) => (
            <VitalsCard
              key={patient.patient_id}
              patient={patient}
              liveReading={globalReadings.get(patient.patient_id)}
              streaming={isRunning}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No patients on your watchlist</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use the search or smart filters above to add patients
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function VitalsCard({ patient, liveReading, streaming }: {
  patient: Patient360; liveReading?: LiveReading; streaming: boolean
}) {
  const v = liveReading || (patient.vitals_summary?.latest as LiveReading | undefined)
  const t = patient.personalized_thresholds

  const hrStatus = v && t ? getStatus(v.heart_rate, t.heart_rate.low, t.heart_rate.high) : "normal"
  const spo2Status = v && t ? getStatus(v.spo2, t.spo2.low, t.spo2.high) : "normal"
  const rrStatus = v && t ? getStatus(v.respiratory_rate, t.respiratory_rate.low, t.respiratory_rate.high) : "normal"
  const tempStatus = v && t ? getStatus(v.temperature, t.temperature.low, t.temperature.high) : "normal"

  const statuses = [hrStatus, spo2Status, rrStatus, tempStatus]
  const worstStatus = statuses.includes("critical")
    ? "critical" : statuses.includes("warning")
      ? "warning" : "normal"

  return (
    <Card className={cn(
      "relative transition-all duration-500",
      streaming && worstStatus === "critical" && "border-destructive/60 bg-destructive/5 shadow-sm shadow-destructive/10",
      streaming && worstStatus === "warning" && "border-warning/50 bg-warning/5",
    )}>
      {/* Header */}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {patient.demographics.given[0]}{patient.demographics.family[0]}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{patient.demographics.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {patient.demographics.age}y {patient.demographics.gender === "female" ? "F" : "M"} · {patient.profile_type}
              </p>
            </div>
          </div>
          <Link href={`/patients/${patient.patient_id}`} className="text-muted-foreground hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </CardHeader>

      <CardContent className="pb-3">
        {!v ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {streaming ? "Waiting for first reading..." : "No vitals data yet"}
          </p>
        ) : (
          <div className="space-y-3">
            {/* 2×2 vital grid */}
            <div className="grid grid-cols-2 gap-2.5">
              <VitalGauge icon={Heart} label="HR" value={Math.round(v.heart_rate)} unit="bpm" status={hrStatus} streaming={streaming} />
              <VitalGauge icon={ActivityIcon} label="SpO2" value={Number(v.spo2.toFixed(1))} unit="%" status={spo2Status} streaming={streaming} />
              <VitalGauge icon={Wind} label="RR" value={Math.round(v.respiratory_rate)} unit="/min" status={rrStatus} streaming={streaming} />
              <VitalGauge icon={Thermometer} label="Temp" value={Number(v.temperature.toFixed(1))} unit="°C" status={tempStatus} streaming={streaming} />
            </div>

            {/* Event + overall status */}
            <div className="flex items-center justify-between border-t pt-2">
              {liveReading?.event ? (
                <Badge variant="destructive" className="text-[10px]">{liveReading.event}</Badge>
              ) : (
                <span className="text-[11px] text-muted-foreground">No events</span>
              )}
              <Badge
                variant={worstStatus === "critical" ? "destructive" : worstStatus === "warning" ? "default" : "outline"}
                className={cn("text-[10px]", worstStatus === "warning" && "bg-warning text-warning-foreground")}
              >
                {worstStatus === "normal" ? "Normal" : worstStatus === "warning" ? "Warning" : "Critical"}
              </Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function VitalGauge({ icon: Icon, label, value, unit, status, streaming }: {
  icon: React.ComponentType<{ className?: string }>
  label: string; value: number; unit: string
  status: "normal" | "warning" | "critical"; streaming: boolean
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 rounded-md border px-2.5 py-2",
      streaming && "transition-all duration-700",
      status === "critical" && "border-destructive/40 bg-destructive/5",
      status === "warning" && "border-warning/40 bg-warning/5",
      status === "normal" && "border-border",
    )}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0",
        status === "normal" && "text-muted-foreground",
        status === "warning" && "text-warning",
        status === "critical" && "text-destructive",
      )} />
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground leading-none mb-0.5">{label}</p>
        <p className={cn("text-sm font-semibold tabular-nums leading-none",
          status === "warning" && "text-warning",
          status === "critical" && "text-destructive",
        )}>
          {value}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">{unit}</span>
        </p>
      </div>
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

function getStatus(value: number, low: number, high: number): "normal" | "warning" | "critical" {
  if (value < low * 0.9 || value > high * 1.1) return "critical"
  if (value < low || value > high) return "warning"
  return "normal"
}

function getWorstStatus(patient: Patient360, reading: LiveReading): "normal" | "warning" | "critical" {
  const t = patient.personalized_thresholds
  const statuses = [
    getStatus(reading.heart_rate, t.heart_rate.low, t.heart_rate.high),
    getStatus(reading.spo2, t.spo2.low, t.spo2.high),
    getStatus(reading.respiratory_rate, t.respiratory_rate.low, t.respiratory_rate.high),
    getStatus(reading.temperature, t.temperature.low, t.temperature.high),
  ]
  if (statuses.includes("critical")) return "critical"
  if (statuses.includes("warning")) return "warning"
  return "normal"
}

function countBreaches(patients: Patient360[], liveReadings: Map<string, LiveReading>): number {
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
