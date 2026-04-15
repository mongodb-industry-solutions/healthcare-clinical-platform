"use client"

import Link from "next/link"
import {
  ArrowLeft,
  Database,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface PatientIdentityBarProps {
  demographics: {
    name: string
    given: string
    family: string
    age: number
    gender: string
  }
  mrn: string
  hospitalName: string
  profileType: string
  timeSinceLastAlert: string | null
  onOpenInsights: () => void
}

export function PatientIdentityBar({
  demographics,
  mrn,
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
