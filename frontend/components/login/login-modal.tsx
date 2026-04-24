"use client"

import * as React from "react"
import {
  Activity,
  ArrowLeft,
  Check,
  Circle,
  HeartPulse,
  Hospital,
  LineChart,
  Loader2,
  Minus,
  Plus,
  TriangleAlert,
  TrendingDown,
  Users,
  Watch,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  useDemo,
  PERSONAS,
  type Persona,
  type SeedConfig,
  type VitalsPattern,
} from "@/lib/demo-context"
import {
  generatePatients,
  generateVitals,
  materializePatient,
  seedCdsRules,
  seedAttributions,
  computeThresholds,
  evaluatePatientCds,
  computePatientCareGaps,
  setSimulationPattern,
  startSimulation,
} from "@/lib/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

// ---------------------------------------------------------------------------
// Profile metadata for the config UI
// ---------------------------------------------------------------------------

const PROFILE_META: Record<
  string,
  {
    label: string
    tagline: string
    severity: { label: string; color: string }
  }
> = {
  target: {
    label: "Target",
    tagline: "T2DM + CKD + HTN — primary demo patient",
    severity: { label: "Critical", color: "text-red-500" },
  },
  healthy: {
    label: "Healthy",
    tagline: "No chronic conditions — comparison baseline",
    severity: { label: "None", color: "text-muted-foreground" },
  },
  diabetic: {
    label: "Diabetic",
    tagline: "T2DM cohort — HEDIS care gap population",
    severity: { label: "Moderate", color: "text-orange-500" },
  },
  cardiac: {
    label: "Cardiac",
    tagline: "CHF / COPD — secondary chronic cohort",
    severity: { label: "High", color: "text-amber-500" },
  },
}

const VITALS_PATTERNS: {
  value: VitalsPattern
  label: string
  icon: React.ElementType
  color: string
}[] = [
  { value: "normal", label: "Normal", icon: Activity, color: "text-emerald-500" },
  { value: "deteriorating", label: "Deteriorating", icon: TrendingDown, color: "text-orange-500" },
  { value: "acute", label: "Acute", icon: TriangleAlert, color: "text-red-500" },
]

// ---------------------------------------------------------------------------
// Persona cards (step 1)
// ---------------------------------------------------------------------------

const ROLE_META: Record<
  string,
  { icon: React.ElementType; gradient: string; ringColor: string }
> = {
  physician: {
    icon: Hospital,
    gradient: "from-primary/20 to-primary/5",
    ringColor: "ring-primary/40",
  },
  patient: {
    icon: LineChart,
    gradient: "from-chart-2/20 to-chart-2/5",
    ringColor: "ring-chart-2/40",
  },
}

const PERSONA_MODE: Record<string, { label: string; detail: string }> = {
  physician: {
    label: "Seed & simulate",
    detail: "Generates patients, evaluates care gaps and alerts, and starts live monitoring",
  },
  patient: {
    label: "Explore existing data",
    detail: "Works with existing data, no generation or simulation required",
  },
}

function PersonaCard({
  persona,
  onSelect,
  disabled,
}: {
  persona: Persona
  onSelect: (p: Persona) => void
  disabled: boolean
}) {
  const meta = ROLE_META[persona.role]
  const mode = PERSONA_MODE[persona.role]
  const Icon = meta.icon

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(persona)}
      className={cn(
        "group relative flex flex-col items-center gap-4 rounded-2xl border bg-card p-8 transition-all",
        "hover:shadow-lg hover:scale-[1.03] hover:border-primary/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-60",
        "cursor-pointer",
      )}
    >
      <div
        className={cn(
          "flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-b ring-2 ring-offset-2 transition-all",
          meta.gradient,
          meta.ringColor,
          "group-hover:ring-primary group-hover:shadow-md",
        )}
      >
        <Avatar className="h-24 w-24">
          <AvatarFallback className="text-3xl font-semibold tracking-wide bg-transparent">
            <Icon className="h-12 w-12 text-foreground/70" strokeWidth={1.5} />
          </AvatarFallback>
        </Avatar>
      </div>
      <div className="text-center space-y-1">
        <p className="text-lg font-semibold">{persona.name}</p>
        <p className="text-sm text-muted-foreground">{persona.description}</p>
        <span className="inline-block rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-medium text-primary">
          {mode.label}
        </span>
        <p className="text-[11px] text-muted-foreground/70 leading-snug max-w-[200px] mx-auto">
          {mode.detail}
        </p>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Persona selection step
// ---------------------------------------------------------------------------

function StepPersona() {
  const { selectPersona } = useDemo()

  return (
    <>
      <DialogHeader className="text-center items-center gap-1 pt-2">
        <DialogTitle className="text-2xl font-bold tracking-tight text-primary">
          Clinical Operations Platform
        </DialogTitle>
        <DialogDescription className="text-base text-center max-w-lg mx-auto">
          A clinical monitoring platform showcasing MongoDB&apos;s document model for healthcare
        </DialogDescription>
      </DialogHeader>

      <div className="px-2 pt-2">
        <p className="text-sm text-muted-foreground text-center mb-6">
          Select the persona you would like to log in as
        </p>
        <div className="grid grid-cols-2 gap-6">
          {PERSONAS.map((persona) => (
            <PersonaCard
              key={persona.name}
              persona={persona}
              onSelect={selectPersona}
              disabled={false}
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-info/10 border border-info/20 px-4 py-3 mt-2">
        <p className="text-sm text-info flex items-center gap-2">
          <span className="text-base">&#x2139;&#xFE0F;</span>
          Selecting a persona will configure the demo with relevant clinical data.
        </p>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Seed configuration step (Frida only)
// ---------------------------------------------------------------------------

function CountStepper({
  value,
  onChange,
  min = 0,
  max = 20,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
        className="h-7 w-14 text-center text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  )
}

function StepConfig() {
  const { seedConfig, setSeedConfig, startSeeding, logout, setSeedProgress, finishSeeding } =
    useDemo()

  const totalPatients = seedConfig.batches.reduce((s, b) => s + b.count, 0)

  const updateBatch = (index: number, patch: Partial<SeedConfig["batches"][0]>) => {
    setSeedConfig((prev) => ({
      ...prev,
      batches: prev.batches.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    }))
  }

  const handleStart = async () => {
    startSeeding()
    try {
      await runSeedPipeline(seedConfig, (progress) => setSeedProgress(progress))
      finishSeeding()
    } catch (err) {
      console.error("Seed pipeline failed:", err)
      finishSeeding()
    }
  }

  return (
    <>
      <DialogHeader className="text-center items-center gap-1 pt-2">
        <DialogTitle className="text-2xl font-bold tracking-tight text-primary">
          Demo Configuration
        </DialogTitle>
        <DialogDescription className="text-base max-w-md">
          Configure the patient population and vitals simulation for this demo session
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        {/* Section 1: Patient Population */}
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Patient Population</h3>
        </div>
        <div className="rounded-lg border overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_8rem_10rem] gap-x-4 bg-muted/50 px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b">
            <span>Profile</span>
            <span className="text-center">Severity</span>
            <span className="text-center">Patients</span>
            <span className="text-center">Pattern</span>
          </div>

          {/* Data rows */}
          {seedConfig.batches.map((batch, index) => {
            const meta = PROFILE_META[batch.profile_type]
            return (
              <div
                key={batch.profile_type}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_5.5rem_8rem_10rem] items-center gap-x-4 px-4 py-3",
                  index < seedConfig.batches.length - 1 && "border-b border-border/60",
                )}
              >
                {/* Profile: badge + tagline stacked */}
                <div className="min-w-0 space-y-0.5">
                  <Badge variant="outline" className="text-xs w-20 justify-center">
                    {meta.label}
                  </Badge>
                  <p className="text-[11px] leading-tight text-muted-foreground">
                    {meta.tagline}
                  </p>
                </div>

                {/* Severity */}
                <span className={cn("text-xs font-medium text-center", meta.severity.color)}>
                  {meta.severity.label}
                </span>

                {/* Count stepper */}
                <div className="flex justify-center">
                  <CountStepper
                    value={batch.count}
                    onChange={(n) => updateBatch(index, { count: n })}
                  />
                </div>

                {/* Vitals pattern */}
                <div className="flex justify-center">
                  <Select
                    value={batch.vitals_pattern}
                    onValueChange={(v) =>
                      updateBatch(index, { vitals_pattern: v as VitalsPattern })
                    }
                  >
                    <SelectTrigger className="h-7 w-full text-xs">
                      <SelectValue>
                        {(() => {
                          const pat = VITALS_PATTERNS.find((p) => p.value === batch.vitals_pattern)
                          if (!pat) return batch.vitals_pattern
                          const Icon = pat.icon
                          return (
                            <span className="flex items-center gap-1.5">
                              <Icon className={cn("h-3.5 w-3.5 shrink-0", pat.color)} strokeWidth={2.5} />
                              {pat.label}
                            </span>
                          )
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {VITALS_PATTERNS.map((p) => {
                        const Icon = p.icon
                        return (
                          <SelectItem key={p.value} value={p.value}>
                            <span className="flex items-center gap-1.5">
                              <Icon className={cn("h-3.5 w-3.5 shrink-0", p.color)} strokeWidth={2.5} />
                              {p.label}
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )
          })}
        </div>

        {/* Section 2: Wearable Patch */}
        <Separator />
        <div className="flex items-center gap-2">
          <Watch className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Wearable Patch Simulation</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Vitals history (hours)
            </label>
            <Input
              type="number"
              min={1}
              max={168}
              value={seedConfig.vitals_hours}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (!isNaN(n))
                  setSeedConfig((prev) => ({
                    ...prev,
                    vitals_hours: Math.min(168, Math.max(1, n)),
                  }))
              }}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Sampling interval (min)
            </label>
            <Input
              type="number"
              min={1}
              max={60}
              value={seedConfig.vitals_interval_minutes}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (!isNaN(n))
                  setSeedConfig((prev) => ({
                    ...prev,
                    vitals_interval_minutes: Math.min(60, Math.max(1, n)),
                  }))
              }}
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" size="sm" onClick={logout}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {totalPatients} patient{totalPatients !== 1 ? "s" : ""} total
          </span>
          <Button onClick={handleStart} disabled={totalPatients === 0}>
            <HeartPulse className="h-4 w-4 mr-2" />
            Start Demo
          </Button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Seeding progress step
// ---------------------------------------------------------------------------

const PIPELINE_STEPS = [
  "Generating synthetic patients",
  "Generating vitals histories",
  "Materializing Patient 360 documents",
  "Seeding CDS rules",
  "Computing personalized thresholds",
  "Evaluating CDS rules (generating alerts)",
  "Computing HEDIS care gaps",
  "Seeding provider attributions",
  "Starting real-time monitoring",
]

function StepSeeding() {
  const { seedProgress } = useDemo()
  const current = seedProgress?.currentStep ?? 0
  const progressPct = seedProgress
    ? Math.round((seedProgress.currentStep / seedProgress.totalSteps) * 100)
    : 0

  return (
    <>
      <DialogHeader className="text-center items-center gap-1 pt-2">
        <DialogTitle className="text-2xl font-bold tracking-tight text-primary">
          Setting up demo
        </DialogTitle>
        <DialogDescription className="text-base max-w-sm">
          Populating the clinical data pipeline&hellip;
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <Progress value={progressPct} className="h-2" />
        <p className="text-xs text-center text-muted-foreground">
          Step {current} of {PIPELINE_STEPS.length}
          {seedProgress?.detail ? ` — ${seedProgress.detail}` : ""}
        </p>

        <div className="space-y-2 px-1">
          {PIPELINE_STEPS.map((label, index) => {
            const stepNum = index + 1
            const done = stepNum < current
            const active = stepNum === current
            return (
              <div
                key={label}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  done && "text-muted-foreground",
                  active && "bg-primary/5 font-medium",
                  !done && !active && "text-muted-foreground/50",
                )}
              >
                {done ? (
                  <Check className="h-4 w-4 text-success shrink-0" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0" />
                )}
                <span>{label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Seed pipeline runner
// ---------------------------------------------------------------------------

async function runSeedPipeline(
  config: SeedConfig,
  onProgress: (progress: {
    currentStep: number
    totalSteps: number
    stepLabel: string
    detail: string
  }) => void,
) {
  const total = 9
  const progress = (step: number, label: string, detail = "") =>
    onProgress({ currentStep: step, totalSteps: total, stepLabel: label, detail })

  // 1. Generate patients
  progress(1, "Generating patients", "Creating FHIR bundles…")
  const allPatientIds: string[] = []
  const patientProfiles: Record<string, string> = {}

  for (const batch of config.batches) {
    if (batch.count === 0) continue
    const resp = await generatePatients({
      count: batch.count,
      profile_type: batch.profile_type,
    })
    allPatientIds.push(...resp.patient_ids)
    for (const pid of resp.patient_ids) {
      patientProfiles[pid] = batch.profile_type
    }
  }

  // 2. Generate vitals
  progress(2, "Generating vitals", `${allPatientIds.length} patients…`)
  const patternMap: Record<string, string> = {}
  for (const batch of config.batches) {
    patternMap[batch.profile_type] = batch.vitals_pattern
  }

  for (const pid of allPatientIds) {
    const profile = patientProfiles[pid]
    const pattern = patternMap[profile] ?? "normal"
    await generateVitals(pid, {
      pattern,
      hours: config.vitals_hours,
      interval_minutes: config.vitals_interval_minutes,
    })
  }

  // 3. Materialize only the newly created patients
  progress(3, "Materializing", `${allPatientIds.length} patients…`)
  for (const pid of allPatientIds) {
    await materializePatient(pid)
  }

  // 4. Seed CDS rules
  progress(4, "Seeding CDS rules", "")
  await seedCdsRules()

  // 5. Compute thresholds
  progress(5, "Computing thresholds", `${allPatientIds.length} patients…`)
  for (const pid of allPatientIds) {
    await computeThresholds(pid)
  }

  // 6. Evaluate only the newly created patients
  progress(6, "Evaluating CDS rules", "Generating alerts…")
  for (const pid of allPatientIds) {
    await evaluatePatientCds(pid)
  }

  // 7. Care gaps for only the newly created patients
  progress(7, "Computing care gaps", "HEDIS measures…")
  for (const pid of allPatientIds) {
    await computePatientCareGaps(pid)
  }

  // 8. Seed provider attributions
  progress(8, "Seeding attributions", "Provider-patient relationships…")
  await seedAttributions()

  // 9. Set simulation patterns per batch and start real-time monitoring
  progress(9, "Starting monitoring", "Launching simulation worker…")
  for (const batch of config.batches) {
    if (batch.count === 0) continue
    const batchPids = allPatientIds.filter((pid) => patientProfiles[pid] === batch.profile_type)
    if (batchPids.length > 0) {
      await setSimulationPattern(batchPids, batch.vitals_pattern)
    }
  }
  await startSimulation({ interval_seconds: 3 })

  onProgress({
    currentStep: 9,
    totalSteps: 9,
    stepLabel: "Complete",
    detail: "Demo ready — live monitoring active!",
  })
}

// ---------------------------------------------------------------------------
// Main login modal — orchestrates the three steps
// ---------------------------------------------------------------------------

export function LoginModal() {
  const { step } = useDemo()
  const open = step !== "ready"

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "rounded-3xl border-0 shadow-2xl",
          step === "config" ? "sm:max-w-3xl" : step === "persona" ? "sm:max-w-2xl" : "sm:max-w-xl",
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {step === "persona" && <StepPersona />}
        {step === "config" && <StepConfig />}
        {step === "seeding" && <StepSeeding />}
      </DialogContent>
    </Dialog>
  )
}
