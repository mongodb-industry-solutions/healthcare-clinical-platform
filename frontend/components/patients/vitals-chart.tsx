"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { cn } from "@/lib/utils"
import { type VitalsTimeSeries } from "@/lib/mock-data"

interface VitalsChartProps {
  data: VitalsTimeSeries[]
  dataKey: keyof Omit<VitalsTimeSeries, "timestamp" | "event">
  label: string
  unit: string
  color: string
  threshold: { low: number; high: number; source_rule: string | null }
  annotations?: ChartAnnotation[]
}

export interface ChartAnnotation {
  label: string
  timestamp: string
  type: "event" | "medication" | "note"
}

export function VitalsChart({
  data,
  dataKey,
  label,
  unit,
  color,
  threshold,
  annotations = [],
}: VitalsChartProps) {
  const chartData = React.useMemo(() => {
    return data.map((reading) => ({
      ...reading,
      time: new Date(reading.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      value: reading[dataKey] as number,
    }))
  }, [data, dataKey])

  const eventPoints = React.useMemo(() => {
    const points: { time: string; value: number; event: string }[] = []
    chartData.forEach((point) => {
      if (point.event) {
        points.push({ time: point.time, value: point.value, event: point.event })
      }
    })
    return points
  }, [chartData])

  const annotationPoints = React.useMemo(() => {
    return annotations
      .map((ann) => {
        const ts = new Date(ann.timestamp).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
        const match = chartData.find((d) => d.time === ts)
        if (!match) return null
        return { ...ann, time: ts, value: match.value }
      })
      .filter(Boolean) as (ChartAnnotation & { time: string; value: number })[]
  }, [annotations, chartData])

  const values = chartData.map((d) => d.value)
  const minValue = Math.min(...values, threshold.low)
  const maxValue = Math.max(...values, threshold.high)
  const padding = (maxValue - minValue) * 0.1
  const domain = [Math.floor(minValue - padding), Math.ceil(maxValue + padding)]

  return (
    <div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              stroke="var(--muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              tick={{ fill: "var(--muted-foreground)" }}
            />
            <YAxis
              stroke="var(--muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              domain={domain}
              tick={{ fill: "var(--muted-foreground)" }}
              tickFormatter={(value) => `${value}`}
            />
            <Tooltip
              content={({ active, payload, label: tooltipLabel }) => {
                if (!active || !payload?.length) return null

                const value = payload[0].value as number
                const event = payload[0].payload.event

                const matchedAnnotation = annotationPoints.find(
                  (ann) => ann.time === tooltipLabel,
                )

                return (
                  <div className="rounded-lg border bg-popover p-3 shadow-md">
                    <div className="text-xs text-muted-foreground">{tooltipLabel}</div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-lg font-bold" style={{ color }}>
                        {typeof value === "number" ? value.toFixed(1) : value}
                      </span>
                      <span className="text-sm text-muted-foreground">{unit}</span>
                    </div>
                    {event && (
                      <div
                        className={cn(
                          "mt-2 text-xs font-medium px-2 py-1 rounded",
                          event === "hypoglycemia" && "bg-warning/20 text-warning",
                          event === "sepsis" && "bg-destructive/20 text-destructive",
                        )}
                      >
                        Event: {event}
                      </div>
                    )}
                    {matchedAnnotation && (
                      <div className="mt-2 text-xs font-medium px-2 py-1 rounded bg-primary/10 text-primary">
                        {matchedAnnotation.type === "medication" ? "Rx: " : ""}
                        {matchedAnnotation.label}
                      </div>
                    )}
                  </div>
                )
              }}
            />
            <ReferenceLine
              y={threshold.high}
              stroke="var(--destructive)"
              strokeDasharray="5 5"
              strokeOpacity={0.7}
              label={{
                value: `High: ${threshold.high}`,
                position: "right",
                fill: "var(--destructive)",
                fontSize: 10,
              }}
            />
            <ReferenceLine
              y={threshold.low}
              stroke="var(--warning)"
              strokeDasharray="5 5"
              strokeOpacity={0.7}
              label={{
                value: `Low: ${threshold.low}`,
                position: "right",
                fill: "var(--warning)",
                fontSize: 10,
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#gradient-${dataKey})`}
              dot={false}
              activeDot={{
                r: 4,
                fill: color,
                stroke: "var(--background)",
                strokeWidth: 2,
              }}
            />
            {eventPoints.map((point, idx) => (
              <ReferenceDot
                key={`ev-${idx}`}
                x={point.time}
                y={point.value}
                r={5}
                fill={point.event === "sepsis" ? "var(--destructive)" : "var(--warning)"}
                stroke="var(--background)"
                strokeWidth={2}
              />
            ))}
            {annotationPoints.map((ann, idx) => (
              <ReferenceDot
                key={`ann-${idx}`}
                x={ann.time}
                y={ann.value}
                r={5}
                fill="var(--primary)"
                stroke="var(--background)"
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Event legend beneath the chart */}
      {(eventPoints.length > 0 || annotationPoints.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {eventPoints.length > 0 && (
            <>
              {eventPoints.some((p) => p.event === "hypoglycemia") && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-warning" />
                  Hypoglycemia event
                </span>
              )}
              {eventPoints.some((p) => p.event === "sepsis") && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
                  Sepsis event
                </span>
              )}
            </>
          )}
          {annotationPoints.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-primary" />
              Annotation ({annotationPoints.length})
            </span>
          )}
        </div>
      )}
    </div>
  )
}
