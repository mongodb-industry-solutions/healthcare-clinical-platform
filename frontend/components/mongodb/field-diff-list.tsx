"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { FieldDiff } from "@/lib/mongodb-demo"

type FieldDiffListProps = {
  diffs: FieldDiff[]
}

const DIFF_STYLES: Record<
  FieldDiff["kind"],
  { label: string; badge: "default" | "secondary" | "outline" | "destructive"; border: string }
> = {
  added: {
    label: "Added",
    badge: "secondary",
    border: "border-emerald-200/70 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20",
  },
  changed: {
    label: "Changed",
    badge: "outline",
    border: "border-sky-200/70 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/20",
  },
  removed: {
    label: "Removed",
    badge: "destructive",
    border: "border-rose-200/70 bg-rose-50/40 dark:border-rose-900 dark:bg-rose-950/20",
  },
}

export function FieldDiffList({ diffs }: FieldDiffListProps) {
  if (diffs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
        No document changes are available for this milestone yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {diffs.map((diff, index) => {
        const style = DIFF_STYLES[diff.kind]

        return (
          <div
            key={`${diff.path}-${index}`}
            className={cn("rounded-lg border p-3", style.border)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="text-xs font-medium text-foreground">{diff.path}</code>
              <Badge variant={style.badge}>{style.label}</Badge>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <ValuePanel label="Before" value={diff.before} muted={diff.kind === "added"} />
              <ValuePanel label="After" value={diff.after} muted={diff.kind === "removed"} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ValuePanel({
  label,
  value,
  muted = false,
}: {
  label: string
  value: unknown
  muted?: boolean
}) {
  return (
    <div className="rounded-md border bg-background/70 p-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <pre
        className={cn(
          "overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground",
          muted && "text-muted-foreground",
        )}
      >
        {stringifyValue(value)}
      </pre>
    </div>
  )
}

function stringifyValue(value: unknown) {
  if (typeof value === "undefined") return "Not present"
  if (typeof value === "string") return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
