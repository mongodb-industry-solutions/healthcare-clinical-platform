"use client"

import { MousePointerClick } from "lucide-react"

export function WorkspaceEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/20 bg-muted/30 py-16 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
        <MousePointerClick className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">
        Select a care gap to begin intervention work
      </p>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-xs">
        Choose a care gap tile above to activate the workflow workspace. The active workflow, supporting context, and vitals trend will appear here.
      </p>
    </div>
  )
}
