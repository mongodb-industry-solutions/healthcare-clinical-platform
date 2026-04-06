"use client"

import * as React from "react"
import { Timer } from "lucide-react"
import { useDemo } from "@/lib/demo-context"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export interface AlertNotification {
  id: string
  patient_id: string
  patient_name: string
  title: string
  severity: "critical" | "high" | "moderate" | "medium" | "low"
  reasoning?: string
  timestamp: string
  read: boolean
}

export interface LiveReading {
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

interface SimulationContextValue {
  isRunning: boolean
  tickCount: number
  patientCount: number
  liveReadings: Map<string, LiveReading>
  recentAlerts: AlertNotification[]
  unreadAlertCount: number
  markAlertsRead: () => void
  markAlertRead: (id: string) => void
}

const SimulationContext = React.createContext<SimulationContextValue | null>(null)

const MAX_ALERTS = 50

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const { step, bumpDataVersion } = useDemo()

  const [isRunning, setIsRunning] = React.useState(false)
  const [tickCount, setTickCount] = React.useState(0)
  const [patientCount, setPatientCount] = React.useState(0)
  const [liveReadings, setLiveReadings] = React.useState<Map<string, LiveReading>>(new Map())
  const [recentAlerts, setRecentAlerts] = React.useState<AlertNotification[]>([])
  const [stoppedInfo, setStoppedInfo] = React.useState<{ reason: string; tickCount: number; message: string } | null>(null)

  const eventSourceRef = React.useRef<EventSource | null>(null)
  const dataVersionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const unreadAlertCount = React.useMemo(
    () => recentAlerts.filter((a) => !a.read).length,
    [recentAlerts],
  )

  const markAlertsRead = React.useCallback(() => {
    setRecentAlerts((prev) => prev.map((a) => ({ ...a, read: true })))
  }, [])

  const markAlertRead = React.useCallback((id: string) => {
    setRecentAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, read: true } : a)),
    )
  }, [])

  const addAlerts = React.useCallback(
    (newAlerts: AlertNotification[]) => {
      setRecentAlerts((prev) => {
        const combined = [...newAlerts, ...prev]
        return combined.slice(0, MAX_ALERTS)
      })

      // Debounced data refresh so dashboard KPIs, sidebar badges, etc. stay current
      if (dataVersionTimerRef.current) clearTimeout(dataVersionTimerRef.current)
      dataVersionTimerRef.current = setTimeout(bumpDataVersion, 2000)
    },
    [bumpDataVersion],
  )

  // Use a ref for addAlerts so the SSE effect doesn't reconnect when the callback identity changes
  const addAlertsRef = React.useRef(addAlerts)
  React.useEffect(() => { addAlertsRef.current = addAlerts }, [addAlerts])

  // Connect SSE when demo is ready — runs once per seed cycle
  React.useEffect(() => {
    if (step !== "ready") return

    const es = new EventSource(`${API_URL}/simulation/stream`)
    eventSourceRef.current = es

    es.addEventListener("connected", (e) => {
      try {
        const data = JSON.parse(e.data)
        setIsRunning(data.running ?? false)
        setPatientCount(data.patient_count ?? 0)
        setTickCount(data.tick_count ?? 0)
      } catch { /* ignore */ }
    })

    es.addEventListener("vitals", (e) => {
      try {
        const data = JSON.parse(e.data)
        setTickCount(data.tick ?? 0)
        setPatientCount(data.patient_count ?? 0)
        setIsRunning(true)

        const readings: LiveReading[] = data.readings || []
        setLiveReadings((prev) => {
          const next = new Map(prev)
          for (const r of readings) {
            next.set(r.patient_id, r)
          }
          return next
        })
      } catch { /* ignore */ }
    })

    es.addEventListener("alerts", (e) => {
      try {
        const data = JSON.parse(e.data)
        const details: Array<{
          patient_id: string
          patient_name: string
          active_alerts: Array<{
            alert_id?: string
            title: string
            severity: string
            reasoning?: string
            created_at?: string
          }>
        }> = data.details || []

        const notifications: AlertNotification[] = []
        const now = new Date().toISOString()

        for (const detail of details) {
          for (const alert of detail.active_alerts) {
            notifications.push({
              id: alert.alert_id || `${detail.patient_id}-${Date.now()}-${Math.random()}`,
              patient_id: detail.patient_id,
              patient_name: detail.patient_name,
              title: alert.title,
              severity: alert.severity as AlertNotification["severity"],
              reasoning: alert.reasoning,
              timestamp: alert.created_at || now,
              read: false,
            })
          }
        }

        if (notifications.length > 0) {
          addAlertsRef.current(notifications)
        }
      } catch { /* ignore */ }
    })

    es.addEventListener("stopped", (e) => {
      setIsRunning(false)
      es.close()
      try {
        const data = JSON.parse(e.data)
        setStoppedInfo({
          reason: data.reason ?? "unknown",
          tickCount: data.tick_count ?? 0,
          message: data.message ?? "The simulation has ended.",
        })
      } catch { /* ignore */ }
    })

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setIsRunning(false)
        eventSourceRef.current = null
      }
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stop simulation on page unload via beacon
  React.useEffect(() => {
    const handleUnload = () => {
      navigator.sendBeacon(`${API_URL}/simulation/stop`)
    }
    window.addEventListener("beforeunload", handleUnload)
    return () => window.removeEventListener("beforeunload", handleUnload)
  }, [])

  const value = React.useMemo<SimulationContextValue>(
    () => ({
      isRunning,
      tickCount,
      patientCount,
      liveReadings,
      recentAlerts,
      unreadAlertCount,
      markAlertsRead,
      markAlertRead,
    }),
    [isRunning, tickCount, patientCount, liveReadings, recentAlerts, unreadAlertCount, markAlertsRead, markAlertRead],
  )

  return (
    <SimulationContext value={value}>
      {children}
      <AlertDialog open={!!stoppedInfo} onOpenChange={(open) => { if (!open) setStoppedInfo(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-2">
              <Timer className="h-6 w-6 text-muted-foreground" />
            </div>
            <AlertDialogTitle className="text-center">
              {stoppedInfo?.reason === "auto_stop" ? "Simulation Complete" : "Simulation Stopped"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              {stoppedInfo?.reason === "auto_stop"
                ? "The 7-minute simulation window has ended. All generated vitals and alerts have been saved."
                : stoppedInfo?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-center gap-6 py-2 text-sm text-muted-foreground">
            <span><strong className="text-foreground">{(stoppedInfo?.tickCount ?? 0) * patientCount}</strong> readings generated</span>
            <span><strong className="text-foreground">{patientCount}</strong> patients monitored</span>
          </div>
          <AlertDialogFooter className="sm:justify-center">
            <AlertDialogAction onClick={() => setStoppedInfo(null)}>
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SimulationContext>
  )
}

export function useSimulation() {
  const ctx = React.useContext(SimulationContext)
  if (!ctx) {
    throw new Error("useSimulation must be used within a SimulationProvider")
  }
  return ctx
}
