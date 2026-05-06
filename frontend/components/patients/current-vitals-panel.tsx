"use client"

import {
  Heart,
  Wind,
  Thermometer,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  Activity as ActivityIcon,
  LineChart,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { Patient360 } from "@/lib/mock-data"

interface CurrentVitalsPanelProps {
  vitalsSummary: Patient360["vitals_summary"]
  thresholds: Patient360["personalized_thresholds"]
  flags: Patient360["flags"]
  onViewTrend?: () => void
}

export function CurrentVitalsPanel({
  vitalsSummary,
  thresholds,
  flags,
  onViewTrend,
}: CurrentVitalsPanelProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Current Vitals</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {formatRelativeTime(vitalsSummary.refreshed_at)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CompactVital
          label="HR"
          value={vitalsSummary.latest.heart_rate}
          unit="bpm"
          trend={vitalsSummary.trend_24h.heart_rate}
          threshold={thresholds.heart_rate}
          note={flags.has_beta_blocker ? "Beta-blocker" : undefined}
        />
        <CompactVital
          label="SpO2"
          value={vitalsSummary.latest.spo2}
          unit="%"
          trend={vitalsSummary.trend_24h.spo2}
          threshold={thresholds.spo2}
          note={flags.has_ckd ? "CKD adj." : undefined}
        />
        <CompactVital
          label="RR"
          value={vitalsSummary.latest.respiratory_rate}
          unit="/min"
          trend={vitalsSummary.trend_24h.respiratory_rate}
          threshold={thresholds.respiratory_rate}
        />
        <CompactVital
          label="Temp"
          value={vitalsSummary.latest.temperature}
          unit="°C"
          trend={vitalsSummary.trend_24h.temperature}
          threshold={thresholds.temperature}
        />
      </div>

      <CompactVital
        label="Activity"
        value={vitalsSummary.latest.activity_level}
        unit="METs"
        trend={vitalsSummary.trend_24h.activity_level}
        threshold={thresholds.activity_level}
        fullWidth
      />

      {onViewTrend && (
        <button
          onClick={onViewTrend}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline pt-1"
        >
          <LineChart className="h-3 w-3" />
          View vitals trend
        </button>
      )}
    </div>
  )
}

function CompactVital({
  label,
  value,
  unit,
  trend,
  threshold,
  note,
  fullWidth,
}: {
  label: string
  value: number
  unit: string
  trend: "stable" | "increasing" | "decreasing"
  threshold: { low: number | null; high: number | null; source_rule: string | null }
  note?: string
  fullWidth?: boolean
}) {
  const status = getVitalStatus(value, threshold.low ?? 0, threshold.high ?? 999)

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        fullWidth && "col-span-2",
        status === "critical" && "border-destructive/50 bg-destructive/5",
        status === "warning" && "border-warning/50 bg-warning/5",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
        <TrendIndicator trend={trend} />
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span
          className={cn(
            "text-lg font-bold tabular-nums",
            status === "warning" && "text-warning",
            status === "critical" && "text-destructive",
          )}
        >
          {value % 1 !== 0 ? value.toFixed(1) : Math.round(value)}
        </span>
        <span className="text-[10px] text-muted-foreground">{unit}</span>
      </div>
      {note && <p className="text-[9px] text-primary mt-0.5">{note}</p>}
    </div>
  )
}

function TrendIndicator({ trend }: { trend: "stable" | "increasing" | "decreasing" }) {
  if (trend === "stable") return <span className="text-[10px] text-muted-foreground">—</span>
  return (
    <span
      className={cn(
        "flex items-center text-[10px]",
        trend === "increasing" ? "text-warning" : "text-success",
      )}
    >
      {trend === "increasing" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
    </span>
  )
}

function getVitalStatus(value: number, low: number, high: number): "normal" | "warning" | "critical" {
  if (value < low * 0.9 || value > high * 1.1) return "critical"
  if (value < low || value > high) return "warning"
  return "normal"
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
