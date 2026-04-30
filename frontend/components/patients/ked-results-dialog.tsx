"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"
import * as React from "react"

type ResultProfile = "stable" | "abnormal" | "concerning"

interface KedResultsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (profile: ResultProfile) => void
  loading: boolean
}

const PROFILES: {
  value: ResultProfile
  label: string
  description: string
  egfr: string
  uacr: string
  tone: string
}[] = [
  {
    value: "stable",
    label: "Stable",
    description: "Normal kidney function — gap closes, no follow-up needed",
    egfr: "72 mL/min/1.73m²",
    uacr: "18 mg/g",
    tone: "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30",
  },
  {
    value: "abnormal",
    label: "Abnormal",
    description: "Reduced eGFR + elevated uACR — gap closes, follow-up recommended",
    egfr: "38 mL/min/1.73m²",
    uacr: "145 mg/g",
    tone: "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30",
  },
  {
    value: "concerning",
    label: "Concerning",
    description: "Mildly reduced eGFR + elevated uACR — gap closes, follow-up recommended",
    egfr: "52 mL/min/1.73m²",
    uacr: "85 mg/g",
    tone: "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30",
  },
]

export function KedResultsDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
}: KedResultsDialogProps) {
  const [selected, setSelected] = React.useState<ResultProfile>("abnormal")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Kidney Lab Results</DialogTitle>
          <DialogDescription>
            Choose a result profile to simulate eGFR and uACR lab values. The KED
            gap will close once results are recorded.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {PROFILES.map((profile) => (
            <button
              key={profile.value}
              onClick={() => setSelected(profile.value)}
              className={cn(
                "w-full rounded-lg border p-3.5 text-left transition-all",
                profile.tone,
                selected === profile.value
                  ? "ring-2 ring-primary ring-offset-1"
                  : "opacity-70 hover:opacity-100",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{profile.label}</span>
                <div className="flex gap-1.5">
                  <Badge variant="outline" className="text-[10px] font-mono">
                    eGFR {profile.egfr}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    uACR {profile.uacr}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {profile.description}
              </p>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={() => onConfirm(selected)} disabled={loading}>
            {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Record Results
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
