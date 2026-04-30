"use client"

import * as React from "react"
import { ArrowRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type DocumentSnapshotDiffProps = {
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export function DocumentSnapshotDiff({ before, after }: DocumentSnapshotDiffProps) {
  const newKeys = React.useMemo(
    () => new Set(Object.keys(after).filter((k) => !(k in before))),
    [before, after],
  )

  const beforeCount = countFields(before)
  const afterCount = countFields(after)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-mono text-[11px]">
          {beforeCount} fields
        </Badge>
        <ArrowRight className="h-3 w-3" />
        <Badge variant="secondary" className="font-mono text-[11px]">
          {afterCount} fields
        </Badge>
        {newKeys.size > 0 && (
          <span className="ml-1 text-emerald-600 dark:text-emerald-400">
            +{newKeys.size} top-level {newKeys.size === 1 ? "section" : "sections"}
          </span>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <JsonPanel label="Before" document={before} variant="before" />
        <JsonPanel label="After" document={after} highlightKeys={newKeys} variant="after" />
      </div>
    </div>
  )
}

function JsonPanel({
  label,
  document,
  highlightKeys,
  variant,
}: {
  label: string
  document: Record<string, unknown>
  highlightKeys?: Set<string>
  variant: "before" | "after"
}) {
  const json = JSON.stringify(document, null, 2)
  const lines = json.split("\n")
  const highlighted = highlightKeys ? computeHighlights(lines, highlightKeys) : []

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border",
        variant === "before"
          ? "border-border/60 bg-muted/10"
          : "border-primary/20 bg-background",
      )}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wider",
            variant === "before" ? "text-muted-foreground" : "text-primary",
          )}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {lines.length} lines
        </span>
      </div>
      <div className="max-h-[22rem] overflow-auto">
        <pre className="p-3 text-[12px] leading-[1.6]">
          {lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "-mx-3 px-3",
                highlighted[i] &&
                  "border-l-2 border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/25",
              )}
            >
              <SyntaxLine text={line} />
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}

function SyntaxLine({ text }: { text: string }) {
  const segments: React.ReactNode[] = []
  const re =
    /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push(
        <span key={key++} className="text-muted-foreground/70">
          {text.slice(lastIndex, match.index)}
        </span>,
      )
    }

    if (match[1]) {
      const isKey = Boolean(match[2])
      segments.push(
        <span
          key={key++}
          className={
            isKey
              ? "text-sky-700 dark:text-sky-300"
              : "text-emerald-700 dark:text-emerald-400"
          }
        >
          {match[1]}
        </span>,
      )
      if (match[2]) {
        segments.push(
          <span key={key++} className="text-muted-foreground/70">
            {match[2]}
          </span>,
        )
      }
    } else if (match[3]) {
      segments.push(
        <span key={key++} className="text-amber-600 dark:text-amber-400">
          {match[3]}
        </span>,
      )
    } else if (match[4]) {
      segments.push(
        <span key={key++} className="text-violet-600 dark:text-violet-400">
          {match[4]}
        </span>,
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push(
      <span key={key++} className="text-muted-foreground/70">
        {text.slice(lastIndex)}
      </span>,
    )
  }

  return <>{segments}</>
}

function computeHighlights(lines: string[], newKeys: Set<string>): boolean[] {
  const result = new Array<boolean>(lines.length).fill(false)
  let inHighlight = false

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()
    const indent = lines[i].length - trimmed.length

    if (indent === 2 && trimmed.startsWith('"')) {
      const keyMatch = trimmed.match(/^"([^"]+)"/)
      inHighlight = Boolean(keyMatch && newKeys.has(keyMatch[1]))
    }

    if (inHighlight && indent >= 2) {
      result[i] = true
    }
  }

  return result
}

function countFields(obj: unknown, depth = 0): number {
  if (depth > 4 || obj === null || obj === undefined) return 0
  if (Array.isArray(obj)) {
    return obj.reduce((sum: number, item) => sum + Math.max(1, countFields(item, depth + 1)), 0)
  }
  if (typeof obj === "object") {
    return Object.values(obj).reduce(
      (sum: number, val) => sum + 1 + countFields(val, depth + 1),
      0,
    )
  }
  return 0
}
