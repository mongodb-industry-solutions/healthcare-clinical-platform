"use client"

import { CheckCircle2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Patient360 } from "@/lib/mock-data"

interface ClinicalConditionsStripProps {
  flags: Patient360["flags"]
}

export function ClinicalConditionsStrip({ flags }: ClinicalConditionsStripProps) {
  const hasAny = flags.has_beta_blocker || flags.has_insulin || flags.has_ckd || flags.has_ace_inhibitor

  if (!hasAny) return null

  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        Clinical Conditions
      </p>
      <div className="flex flex-wrap gap-1.5">
        {flags.has_beta_blocker && (
          <ConditionChip label="Beta-blocker" effect="HR threshold: 90 bpm (vs 100)" />
        )}
        {flags.has_insulin && (
          <ConditionChip label="Insulin therapy" effect="Hypoglycemia monitoring enabled" />
        )}
        {flags.has_ckd && (
          <ConditionChip label="CKD patient" effect="SpO2 threshold: 92% (vs 95)" />
        )}
        {flags.has_ace_inhibitor && (
          <ConditionChip label="ACE inhibitor" effect="Potassium monitoring" />
        )}
      </div>
    </div>
  )
}

function ConditionChip({ label, effect }: { label: string; effect: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10">
          <CheckCircle2 className="h-3 w-3" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-xs p-3" side="bottom" align="start">
        <p className="text-xs font-medium">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{effect}</p>
      </PopoverContent>
    </Popover>
  )
}
