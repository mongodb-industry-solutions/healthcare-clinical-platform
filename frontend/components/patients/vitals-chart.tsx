"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
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
}

export function VitalsChart({
  data,
  dataKey,
  label,
  unit,
  color,
  threshold,
}: VitalsChartProps) {
  // Format data for the chart
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

  // Calculate domain with some padding
  const values = chartData.map((d) => d.value)
  const minValue = Math.min(...values, threshold.low)
  const maxValue = Math.max(...values, threshold.high)
  const padding = (maxValue - minValue) * 0.1
  const domain = [Math.floor(minValue - padding), Math.ceil(maxValue + padding)]

  return (
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
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null

              const value = payload[0].value as number
              const event = payload[0].payload.event

              return (
                <div className="rounded-lg border bg-popover p-3 shadow-md">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-lg font-bold" style={{ color }}>
                      {typeof value === "number" ? value.toFixed(1) : value}
                    </span>
                    <span className="text-sm text-muted-foreground">{unit}</span>
                  </div>
                  {event && (
                    <div className={cn(
                      "mt-2 text-xs font-medium px-2 py-1 rounded",
                      event === "hypoglycemia" && "bg-warning/20 text-warning",
                      event === "sepsis" && "bg-destructive/20 text-destructive"
                    )}>
                      Event: {event}
                    </div>
                  )}
                </div>
              )
            }}
          />
          {/* High threshold line */}
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
          {/* Low threshold line */}
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
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
