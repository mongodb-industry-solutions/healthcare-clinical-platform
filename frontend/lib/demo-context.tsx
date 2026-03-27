"use client"

import * as React from "react"

export type PersonaRole = "physician" | "patient"

export interface Persona {
  name: string
  role: PersonaRole
  initials: string
  description: string
}

export const PERSONAS: Persona[] = [
  {
    name: "Frida",
    role: "physician",
    initials: "FR",
    description: "Physician view",
  },
  {
    name: "Diego",
    role: "patient",
    initials: "DI",
    description: "Patient view",
  },
]

export type DemoStep = "persona" | "config" | "seeding" | "ready"

export type VitalsPattern = "normal" | "deteriorating" | "acute"

export interface ProfileBatch {
  profile_type: string
  count: number
  vitals_pattern: VitalsPattern
}

export interface SeedConfig {
  batches: ProfileBatch[]
  vitals_hours: number
  vitals_interval_minutes: number
}

export const DEFAULT_SEED_CONFIG: SeedConfig = {
  batches: [
    { profile_type: "target", count: 2, vitals_pattern: "deteriorating" },
    { profile_type: "healthy", count: 3, vitals_pattern: "normal" },
    { profile_type: "diabetic", count: 2, vitals_pattern: "deteriorating" },
    { profile_type: "cardiac", count: 2, vitals_pattern: "deteriorating" },
  ],
  vitals_hours: 24,
  vitals_interval_minutes: 5,
}

export interface SeedProgress {
  currentStep: number
  totalSteps: number
  stepLabel: string
  detail: string
}

interface DemoContextValue {
  persona: Persona | null
  step: DemoStep
  seedConfig: SeedConfig
  seedProgress: SeedProgress | null
  /** Incremented after every successful seed — use as useEffect dependency to re-fetch data */
  dataVersion: number
  selectPersona: (persona: Persona) => void
  goToConfig: () => void
  setSeedConfig: React.Dispatch<React.SetStateAction<SeedConfig>>
  startSeeding: () => void
  setSeedProgress: (progress: SeedProgress | null) => void
  finishSeeding: () => void
  logout: () => void
}

const STORAGE_KEY = "leafy-health-demo"

function loadPersistedState(): { persona: Persona | null; step: DemoStep; dataVersion: number } {
  if (typeof window === "undefined") return { persona: null, step: "persona", dataVersion: 0 }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        persona: parsed.persona ?? null,
        step: parsed.step === "ready" ? "ready" : "persona",
        dataVersion: parsed.dataVersion ?? 0,
      }
    }
  } catch {
    // ignore parse errors
  }
  return { persona: null, step: "persona", dataVersion: 0 }
}

function persistState(persona: Persona | null, step: DemoStep, dataVersion: number) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ persona, step, dataVersion }))
  } catch {
    // quota errors etc.
  }
}

const DemoContext = React.createContext<DemoContextValue | null>(null)

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = React.useState(false)
  const [persona, setPersona] = React.useState<Persona | null>(null)
  const [step, setStep] = React.useState<DemoStep>("persona")
  const [dataVersion, setDataVersion] = React.useState(0)
  const [seedConfig, setSeedConfig] = React.useState<SeedConfig>(DEFAULT_SEED_CONFIG)
  const [seedProgress, setSeedProgress] = React.useState<SeedProgress | null>(null)

  // Restore persisted state on first client render
  React.useEffect(() => {
    const saved = loadPersistedState()
    setPersona(saved.persona)
    setStep(saved.step)
    setDataVersion(saved.dataVersion)
    setHydrated(true)
  }, [])

  // Persist whenever persona/step/dataVersion changes (after hydration)
  React.useEffect(() => {
    if (hydrated) {
      persistState(persona, step, dataVersion)
    }
  }, [persona, step, dataVersion, hydrated])

  const selectPersona = React.useCallback((p: Persona) => {
    setPersona(p)
    if (p.role === "physician") {
      setStep("config")
    } else {
      setStep("ready")
    }
  }, [])

  const goToConfig = React.useCallback(() => {
    setStep("config")
  }, [])

  const startSeeding = React.useCallback(() => {
    setStep("seeding")
  }, [])

  const finishSeeding = React.useCallback(() => {
    setStep("ready")
    setDataVersion((v) => v + 1)
  }, [])

  const logout = React.useCallback(() => {
    setPersona(null)
    setStep("persona")
    setSeedConfig(DEFAULT_SEED_CONFIG)
    setSeedProgress(null)
  }, [])

  const value = React.useMemo<DemoContextValue>(
    () => ({
      persona,
      step,
      seedConfig,
      seedProgress,
      dataVersion,
      selectPersona,
      goToConfig,
      setSeedConfig,
      startSeeding,
      setSeedProgress,
      finishSeeding,
      logout,
    }),
    [persona, step, seedConfig, seedProgress, dataVersion, selectPersona, goToConfig, startSeeding, finishSeeding, logout],
  )

  // Don't render children until hydrated to avoid flash of login modal
  if (!hydrated) return null

  return <DemoContext value={value}>{children}</DemoContext>
}

export function useDemo() {
  const ctx = React.useContext(DemoContext)
  if (!ctx) {
    throw new Error("useDemo must be used within a DemoProvider")
  }
  return ctx
}
