"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Database,
  Info,
  Stethoscope,
  UserRound,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  fetchPatientAttributions,
  type PatientAttribution,
} from "@/lib/api"

interface PatientIdentityBarProps {
  demographics: {
    name: string
    given: string
    family: string
    age: number
    gender: string
  }
  mrn: string
  patientId: string
  hospitalName: string
  profileType: string
  timeSinceLastAlert: string | null
  onOpenInsights: () => void
}

export function PatientIdentityBar({
  demographics,
  mrn,
  patientId,
  hospitalName,
  profileType,
  timeSinceLastAlert,
  onOpenInsights,
}: PatientIdentityBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="ghost" size="icon" asChild>
        <Link href="/patients">
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back to patients</span>
        </Link>
      </Button>

      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
        {demographics.given[0]}
        {demographics.family[0]}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold truncate">{demographics.name}</h1>
          <Badge variant="outline" className="text-xs shrink-0">
            {demographics.age}y {demographics.gender === "female" ? "F" : "M"}
          </Badge>
          <ProfileBadge profile={profileType} />
        </div>
        <p className="text-xs text-muted-foreground">
          MRN: {mrn}
          <span className="mx-1.5">·</span>
          {hospitalName}
          {timeSinceLastAlert && (
            <>
              <span className="mx-1.5">·</span>
              Last alert: {timeSinceLastAlert}
            </>
          )}
        </p>
        <AttributionStrip patientId={patientId} />
      </div>

      <Button
        className="h-10 rounded-full border border-[#0b5d3b] bg-[#0f5f3d] px-4 text-white shadow-sm transition-all hover:bg-[#0c4f33] hover:shadow-md"
        onClick={onOpenInsights}
      >
        <Database className="h-4 w-4" />
        MongoDB Insights
      </Button>
    </div>
  )
}

/** Compact "Attributed: ..." line under the demographics block. */
function AttributionStrip({ patientId }: { patientId: string }) {
  const [attributions, setAttributions] = React.useState<PatientAttribution[] | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchPatientAttributions(patientId)
      .then((res) => {
        if (cancelled) return
        // Only show verified attributions — unverified rows are noise from
        // expired rosters and shouldn't drive the "responsible clinician"
        // narrative the bar is trying to project.
        setAttributions(res.attributions.filter((a) => a.verified))
      })
      .catch(() => {
        if (!cancelled) setAttributions([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [patientId])

  if (loading) {
    return (
      <p className="mt-1 text-[11px] text-muted-foreground/70">
        Loading attribution…
      </p>
    )
  }

  if (!attributions || attributions.length === 0) {
    return null
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
        Attributed
      </span>
      <span className="text-[11px] text-muted-foreground/70">·</span>
      {attributions.map((attr, idx) => (
        <React.Fragment key={attr.attribution_id}>
          {idx > 0 && (
            <span className="text-[11px] text-muted-foreground/60">·</span>
          )}
          <AttributionPill attribution={attr} />
        </React.Fragment>
      ))}
      <AttributionInfoTip />
    </div>
  )
}

function AttributionPill({ attribution }: { attribution: PatientAttribution }) {
  const Icon = attribution.provider_role === "pcp" ? Stethoscope : UserRound
  const roleLabel = formatProviderRole(attribution.provider_role)
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] text-foreground">
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="font-medium">{attribution.provider_name}</span>
      <span className="text-muted-foreground">({roleLabel})</span>
    </span>
  )
}

function AttributionInfoTip() {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/60 hover:text-muted-foreground"
            aria-label="What is provider attribution?"
          >
            <Info className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px] text-[11px] leading-relaxed">
          Provider attribution = the clinician responsible for this patient
          under value-based contracts. Defined by Da Vinci ATR.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function formatProviderRole(role: string): string {
  switch (role) {
    case "pcp":
      return "PCP"
    case "care_coordinator":
      return "Care Coord."
    case "specialist":
      return "Specialist"
    default:
      return role.replace(/_/g, " ")
  }
}

function ProfileBadge({ profile }: { profile: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    target: {
      label: "High Risk",
      className: "bg-destructive/10 text-destructive border-destructive/20",
    },
    diabetic: { label: "Diabetic", className: "bg-warning/10 text-warning border-warning/20" },
    cardiac: { label: "Cardiac", className: "bg-chart-1/10 text-chart-1 border-chart-1/20" },
    healthy: { label: "Healthy", className: "bg-success/10 text-success border-success/20" },
  }
  const v = variants[profile] || { label: profile, className: "" }
  return (
    <Badge variant="outline" className={cn("text-xs", v.className)}>
      {v.label}
    </Badge>
  )
}
