"use client"

import * as React from "react"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import type { CareGap } from "@/lib/mock-data"

interface MobileCareGapWorkspaceSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeGap: CareGap | null
  children: React.ReactNode
}

export function MobileCareGapWorkspaceSheet({
  open,
  onOpenChange,
  activeGap,
  children,
}: MobileCareGapWorkspaceSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {activeGap
              ? `${activeGap.hedis_measure} — ${activeGap.measure_name}`
              : "Care Gap Workspace"}
          </SheetTitle>
          <SheetDescription>
            {activeGap
              ? "Active intervention workflow"
              : "Select a care gap to begin"}
          </SheetDescription>
        </SheetHeader>
        <div className="py-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
