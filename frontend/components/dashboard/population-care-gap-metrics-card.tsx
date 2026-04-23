"use client"

import * as React from "react"
import {
  AlertTriangle,
  Building2,
  Database,
  Filter,
  Info,
  Loader2,
  RefreshCcw,
  TrendingUp,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { JsonTreeView } from "@/components/mongodb/json-tree-view"
import {
  fetchPopulationCareGapMetrics,
  fetchProviders,
  type CareGapHospitalBreakdown,
  type CareGapMeasureMetric,
  type CareGapPriorityBucket,
  type PopulationCareGapMetricsResponse,
  type ProviderSummary,
} from "@/lib/api"
import { useDemo } from "@/lib/demo-context"
import { cn } from "@/lib/utils"

const HOSPITAL_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All hospitals" },
  { value: "st_marys", label: "St. Mary's Medical Center" },
  { value: "regional_general", label: "Regional General Hospital" },
  { value: "community_health", label: "Community Health Partners" },
]

const PROFILE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All profiles" },
  { value: "target", label: "Diabetic + CKD (target)" },
  { value: "diabetic", label: "Diabetic" },
  { value: "cardiac", label: "Cardiac" },
  { value: "healthy", label: "Healthy baseline" },
]

// Persist the "scope to my panel" choice across reloads — the demo narrative
// hinges on the recruiter being able to film "now I'll scope to my panel" and
// see the same selection if the page is refreshed.
const PROVIDER_FILTER_STORAGE_KEY = "dashboard.providerFilter.v1"

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/40 dark:text-orange-200",
  moderate: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200",
  low: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200",
}

export function PopulationCareGapMetricsCard() {
  const { dataVersion } = useDemo()
  const [hospital, setHospital] = React.useState<string>("all")
  const [profile, setProfile] = React.useState<string>("all")
  // Lazy-init from localStorage so the value is correct on first render and
  // we don't fire a useless aggregation against the unfiltered panel before
  // the persisted selection rehydrates.
  const [providerId, setProviderId] = React.useState<string>(() => {
    if (typeof window === "undefined") return "all"
    return window.localStorage.getItem(PROVIDER_FILTER_STORAGE_KEY) || "all"
  })
  const [providers, setProviders] = React.useState<ProviderSummary[]>([])
  const [providersLoading, setProvidersLoading] = React.useState(true)
  const [data, setData] = React.useState<PopulationCareGapMetricsResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [pipelineOpen, setPipelineOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setProvidersLoading(true)
    fetchProviders()
      .then((res) => {
        if (cancelled) return
        setProviders(res)
        // If the persisted provider has been deleted/renamed since the last
        // session, silently drop back to "all" rather than send a request
        // that would short-circuit to an empty response.
        if (
          providerId !== "all" &&
          !res.some((p) => p.provider_id === providerId)
        ) {
          setProviderId("all")
          window.localStorage.removeItem(PROVIDER_FILTER_STORAGE_KEY)
        }
      })
      .catch(() => {
        if (!cancelled) setProviders([])
      })
      .finally(() => {
        if (!cancelled) setProvidersLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Run once on mount + whenever the demo data is reseeded; intentionally
    // NOT depending on `providerId` to avoid a refetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion])

  const handleProviderChange = React.useCallback((next: string) => {
    setProviderId(next)
    if (typeof window === "undefined") return
    if (next === "all") {
      window.localStorage.removeItem(PROVIDER_FILTER_STORAGE_KEY)
    } else {
      window.localStorage.setItem(PROVIDER_FILTER_STORAGE_KEY, next)
    }
  }, [])

  const load = React.useCallback(() => {
    setLoading(true)
    fetchPopulationCareGapMetrics({
      hospital: hospital === "all" ? null : hospital,
      profile_type: profile === "all" ? null : profile,
      provider_id: providerId === "all" ? null : providerId,
    })
      .then((res) => {
        setData(res)
        setError(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [hospital, profile, providerId])

  React.useEffect(() => {
    load()
  }, [load, dataVersion])

  // Item 5 introduced first-class `due_soon` (DEQM "prospective"). Show the
  // column unconditionally so the measurement narrative stays stable across
  // hospital/profile filters even when a particular slice has zero in-window
  // screenings closing soon.
  const showDueSoonColumn = true

  const totalOpenGaps = React.useMemo(() => {
    return data?.by_measure.reduce((sum, m) => sum + m.open, 0) ?? 0
  }, [data])

  return (
    <Card className="border-emerald-200/70 bg-gradient-to-br from-white to-emerald-50/30 dark:from-slate-950 dark:to-emerald-950/10">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              <CardTitle className="text-lg">Population Care-Gap Health</CardTitle>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="cursor-default border-emerald-300 bg-white text-[10px] font-medium uppercase tracking-wide text-emerald-800 dark:bg-transparent dark:text-emerald-300">
                      MongoDB $facet
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px] text-xs">
                    Runs multiple independent sub-aggregations over the same input documents in a single pipeline stage. One MongoDB round-trip returns breakdowns by measure, priority, and hospital simultaneously.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />

            <Select value={hospital} onValueChange={setHospital}>
              <SelectTrigger size="sm" className="h-8 min-w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOSPITAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={profile} onValueChange={setProfile}>
              <SelectTrigger size="sm" className="h-8 min-w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROFILE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={providerId}
              onValueChange={handleProviderChange}
              disabled={providersLoading}
            >
              <SelectTrigger size="sm" className="h-8 min-w-[200px]">
                <SelectValue
                  placeholder={providersLoading ? "Loading providers…" : "All providers"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.provider_id} value={p.provider_id}>
                    {p.provider_name} · {p.patient_count} pts
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/70 hover:text-muted-foreground"
                    aria-label="What is provider attribution?"
                  >
                    <Info className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px] text-[11px] leading-relaxed">
                  Provider attribution = the clinician responsible for this
                  patient under value-based contracts. Defined by Da Vinci ATR.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={load}
              disabled={loading}
              aria-label="Re-run aggregation"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {data ? (
          <SummaryStrip
            totalPatients={data.total_patients}
            totalOpenGaps={totalOpenGaps}
            aggregationMs={data.aggregation_ms}
            byPriority={data.by_priority}
          />
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {error ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200">
            Failed to load population metrics — {error}
          </div>
        ) : null}

        {loading && !data ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Aggregating population metrics…
          </div>
        ) : null}

        {data && data.total_patients === 0 ? (
          <div className="rounded-md border border-dashed border-emerald-200 bg-white/60 p-6 text-center text-sm text-muted-foreground dark:border-emerald-900 dark:bg-transparent">
            No patients match the current filters. Re-seed the demo data or relax the filters to see population metrics.
          </div>
        ) : null}

        {data && data.total_patients > 0 ? (
          <MeasureTable measures={data.by_measure} showDueSoonColumn={showDueSoonColumn} />
        ) : null}

        {data && data.by_hospital.length > 0 ? (
          <HospitalSourceBreakdown rows={data.by_hospital} />
        ) : null}

        {data ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-fit gap-2 border-emerald-200 text-xs text-emerald-800 dark:border-emerald-900 dark:text-emerald-200"
              onClick={() => setPipelineOpen(true)}
            >
              <Database className="h-3.5 w-3.5" />
              View MongoDB pipeline
            </Button>

            <Dialog open={pipelineOpen} onOpenChange={setPipelineOpen}>
              <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <Database className="h-4 w-4 text-emerald-700" />
                    MongoDB $facet pipeline
                  </DialogTitle>
                </DialogHeader>
                <div className="rounded-md border bg-muted/30 p-1">
                  <JsonTreeView value={parsePipeline(data.pipeline_display)} collapsed={3} />
                </div>
                <p className="text-xs text-muted-foreground">
                  The pipeline ran in <span className="font-medium text-foreground">{data.aggregation_ms} ms</span> against
                  the same Patient 360 collection the dashboard reads from.
                </p>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function SummaryStrip({
  totalPatients,
  totalOpenGaps,
  aggregationMs,
  byPriority,
}: {
  totalPatients: number
  totalOpenGaps: number
  aggregationMs: number
  byPriority: CareGapPriorityBucket[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-emerald-100 bg-white/70 px-4 py-2 text-xs dark:border-emerald-900 dark:bg-transparent">
      <SummaryStat label="Patients in scope" value={totalPatients.toLocaleString()} />
      <SummaryStat label="Open care gaps" value={totalOpenGaps.toLocaleString()} />
      <SummaryStat
        label="Aggregation"
        value={`${aggregationMs} ms`}
        tooltip="End-to-end time spent running the aggregation pipeline against MongoDB."
      />
      {byPriority.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Open by priority</span>
          {byPriority.map((bucket) => (
            <Badge
              key={bucket.priority}
              variant="outline"
              className={cn(
                "h-5 gap-1 px-1.5 text-[10px] font-medium uppercase",
                PRIORITY_BADGE[bucket.priority] ?? "",
              )}
            >
              {bucket.priority}
              <span className="font-semibold">{bucket.count}</span>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SummaryStat({
  label,
  value,
  tooltip,
}: {
  label: string
  value: string
  tooltip?: string
}) {
  const stat = (
    <div className="flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
  if (!tooltip) return stat
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{stat}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function MeasureTable({
  measures,
  showDueSoonColumn,
}: {
  measures: CareGapMeasureMetric[]
  showDueSoonColumn: boolean
}) {
  return (
    <div className="overflow-hidden rounded-md border bg-white dark:bg-transparent">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Measure</th>
            <th className="px-4 py-2 text-left font-medium">% open</th>
            <th className="px-4 py-2 text-left font-medium">Open / applicable</th>
            <th className="px-4 py-2 text-left font-medium">Closed</th>
            <th className="px-4 py-2 text-left font-medium">Flagged</th>
            {showDueSoonColumn ? <th className="px-4 py-2 text-left font-medium">Due soon</th> : null}
            <th className="px-4 py-2 text-left font-medium">Avg overdue</th>
            <th className="px-4 py-2 text-left font-medium">Max overdue</th>
          </tr>
        </thead>
        <tbody>
          {measures.map((m) => (
            <MeasureRow key={m.hedis_measure} measure={m} showDueSoonColumn={showDueSoonColumn} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MeasureRow({
  measure,
  showDueSoonColumn,
}: {
  measure: CareGapMeasureMetric
  showDueSoonColumn: boolean
}) {
  const notApplicable = measure.applicable_count === 0
  const pct = Math.min(measure.open_pct, 100)
  const pctTone = pct >= 60
    ? "text-red-700 dark:text-red-300"
    : pct >= 30
      ? "text-amber-700 dark:text-amber-300"
      : "text-emerald-700 dark:text-emerald-300"

  return (
    <tr className="border-t text-sm">
      <td className="px-4 py-3">
        <div className="font-medium text-foreground">{measure.hedis_measure}</div>
        <div className="text-xs text-muted-foreground">{measure.measure_name}</div>
      </td>
      <td className="px-4 py-3">
        {notApplicable ? (
          <span className="text-xs text-muted-foreground">n/a</span>
        ) : (
          <div className="flex w-32 flex-col gap-1">
            <span className={cn("text-sm font-semibold", pctTone)}>{measure.open_pct}%</span>
            <Progress value={pct} className="h-1.5" />
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        {notApplicable ? (
          <span className="text-xs text-muted-foreground">— / 0</span>
        ) : (
          <span className="text-sm">
            <span className="font-semibold text-foreground">{measure.open}</span>
            <span className="text-muted-foreground"> / {measure.applicable_count}</span>
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          {measure.closed_controlled}
        </span>
      </td>
      <td className="px-4 py-3">
        {measure.closed_uncontrolled > 0 ? (
          <Badge
            variant="outline"
            className="gap-1 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <AlertTriangle className="h-3 w-3" />
            {measure.closed_uncontrolled}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        )}
      </td>
      {showDueSoonColumn ? (
        <td className="px-4 py-3">
          {measure.due_soon > 0 ? (
            <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
              {measure.due_soon}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">0</span>
          )}
        </td>
      ) : null}
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {measure.avg_days_overdue > 0 ? `${measure.avg_days_overdue.toFixed(0)} d` : "—"}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {measure.max_days_overdue > 0 ? `${measure.max_days_overdue} d` : "—"}
      </td>
    </tr>
  )
}

function HospitalSourceBreakdown({ rows }: { rows: CareGapHospitalBreakdown[] }) {
  const grouped = React.useMemo(() => {
    const buckets = new Map<string, { hospital: string; hospitalName: string; total: number; perMeasure: { measure: string; count: number }[] }>()
    for (const row of rows) {
      const bucket = buckets.get(row.hospital) ?? {
        hospital: row.hospital,
        hospitalName: row.hospital_name ?? row.hospital,
        total: 0,
        perMeasure: [],
      }
      bucket.total += row.open_count
      bucket.perMeasure.push({ measure: row.hedis_measure, count: row.open_count })
      buckets.set(row.hospital, bucket)
    }
    return Array.from(buckets.values()).sort((a, b) => b.total - a.total)
  }, [rows])

  if (grouped.length === 0) return null

  return (
    <div className="rounded-md border bg-white p-3 text-xs dark:bg-transparent">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" />
        <span>Open gaps by source hospital</span>
        <TrendingUp className="ml-auto h-3.5 w-3.5" />
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {grouped.map((g) => (
          <div key={g.hospital} className="rounded border border-muted/60 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">{g.hospitalName}</span>
              <span className="text-sm font-semibold">{g.total}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
              {g.perMeasure.map((pm) => (
                <Badge key={pm.measure} variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">
                  {pm.measure}: {pm.count}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function parsePipeline(pipeline: string): unknown {
  try {
    return JSON.parse(pipeline)
  } catch {
    return pipeline
  }
}
