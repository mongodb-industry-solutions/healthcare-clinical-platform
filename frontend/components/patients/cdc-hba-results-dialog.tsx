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

type ResultProfile = "controlled" | "elevated" | "concerning"

interface CdcHbaResultsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (profile: ResultProfile) => void
  loading: boolean
}

const PROFILES: {
  value: ResultProfile
  label: string
  description: string
  hba1c: string
  tone: string
}[] = [
  {
    value: "controlled",
    label: "Controlled",
    description: "HbA1c in target range — gap closes, no follow-up needed",
    hba1c: "6.7 %",
    tone: "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30",
  },
  {
    value: "elevated",
    label: "Elevated",
    description: "HbA1c above target — gap closes, follow-up recommended",
    hba1c: "8.4 %",
    tone: "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30",
  },
  {
    value: "concerning",
    label: "Concerning",
    description: "HbA1c significantly above target — gap closes, urgent follow-up recommended",
    hba1c: "10.2 %",
    tone: "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30",
  },
]

export function CdcHbaResultsDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
}: CdcHbaResultsDialogProps) {
  const [selected, setSelected] = React.useState<ResultProfile>("elevated")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record HbA1c Result</DialogTitle>
          <DialogDescription>
            Choose a result profile to simulate an HbA1c lab value. The CDC-HBA
            gap will close once the result is recorded.
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
                <Badge variant="outline" className="text-[10px] font-mono">
                  HbA1c {profile.hba1c}
                </Badge>
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
            Record Result
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
