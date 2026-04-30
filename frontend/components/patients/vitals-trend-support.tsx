"use client"

import { Pill, Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VitalsChart, type ChartAnnotation } from "./vitals-chart"
import type { VitalsTimeSeries } from "@/lib/mock-data"

interface VitalsTrendSupportProps {
  readings: VitalsTimeSeries[]
  thresholds: Record<string, { low: number | null; high: number | null; source_rule: string | null }>
  vitalsHours: number
  onSetVitalsHours: (h: number) => void
  annotations: ChartAnnotation[]
  onOpenAnnotationDialog: () => void
}

function safeThreshold(t: { low: number | null; high: number | null; source_rule: string | null } | undefined) {
  return { low: t?.low ?? 0, high: t?.high ?? 999, source_rule: t?.source_rule ?? null }
}

export function VitalsTrendSupport({
  readings,
  thresholds,
  vitalsHours,
  onSetVitalsHours,
  annotations,
  onOpenAnnotationDialog,
}: VitalsTrendSupportProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Vitals Trend ({vitalsHours}h)</h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={onOpenAnnotationDialog}
          >
            <Plus className="h-3 w-3" />
            Annotate
          </Button>
          <div className="flex gap-1">
            {[6, 12, 24, 48, 72, 168].map((h) => (
              <Button
                key={h}
                variant={vitalsHours === h ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onSetVitalsHours(h)}
              >
                {h}h
              </Button>
            ))}
          </div>
        </div>
      </div>

      {readings.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          No vitals data available for this time window
        </p>
      ) : (
        <Tabs defaultValue="heart_rate" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="heart_rate">Heart Rate</TabsTrigger>
            <TabsTrigger value="spo2">SpO2</TabsTrigger>
            <TabsTrigger value="respiratory">Resp Rate</TabsTrigger>
            <TabsTrigger value="temperature">Temp</TabsTrigger>
          </TabsList>
          <TabsContent value="heart_rate">
            <VitalsChart
              data={readings}
              dataKey="heart_rate"
              label="Heart Rate"
              unit="bpm"
              color="var(--chart-1)"
              threshold={safeThreshold(thresholds.heart_rate)}
              annotations={annotations}
            />
          </TabsContent>
          <TabsContent value="spo2">
            <VitalsChart
              data={readings}
              dataKey="spo2"
              label="SpO2"
              unit="%"
              color="var(--chart-2)"
              threshold={safeThreshold(thresholds.spo2)}
              annotations={annotations}
            />
          </TabsContent>
          <TabsContent value="respiratory">
            <VitalsChart
              data={readings}
              dataKey="respiratory_rate"
              label="Respiratory Rate"
              unit="/min"
              color="var(--chart-3)"
              threshold={safeThreshold(thresholds.respiratory_rate)}
              annotations={annotations}
            />
          </TabsContent>
          <TabsContent value="temperature">
            <VitalsChart
              data={readings}
              dataKey="temperature"
              label="Temperature"
              unit="°C"
              color="var(--chart-4)"
              threshold={safeThreshold(thresholds.temperature)}
              annotations={annotations}
            />
          </TabsContent>
        </Tabs>
      )}

      {annotations.length > 0 && (
        <div className="border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Chart Annotations</p>
          <div className="flex flex-wrap gap-2">
            {annotations.map((ann, i) => (
              <Badge
                key={i}
                variant="outline"
                className={cn(
                  "text-xs gap-1",
                  ann.type === "event" && "border-warning/50 text-warning",
                  ann.type === "medication" && "border-primary/50 text-primary",
                )}
              >
                {ann.type === "medication" && <Pill className="h-3 w-3" />}
                {ann.label}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
