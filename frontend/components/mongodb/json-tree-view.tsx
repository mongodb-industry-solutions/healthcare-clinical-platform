"use client"

import * as React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

type JsonTreeViewProps = {
  value: unknown
  defaultCollapsedDepth?: number
  maxHeightClassName?: string
}

export function JsonTreeView({
  value,
  defaultCollapsedDepth = 1,
  maxHeightClassName = "max-h-[26rem]",
}: JsonTreeViewProps) {
  const [openMap, setOpenMap] = React.useState<Record<string, boolean>>({})

  const togglePath = React.useCallback((path: string, isOpen: boolean) => {
    setOpenMap((current) => ({ ...current, [path]: !isOpen }))
  }, [])

  return (
    <div
      className={cn(
        "relative max-w-full overflow-auto rounded-lg border bg-muted/20",
        maxHeightClassName,
      )}
    >
      <div className="min-w-0 max-w-full p-3 font-mono text-xs leading-6">
        <JsonNode
          label="root"
          value={value}
          depth={0}
          path="$"
          defaultCollapsedDepth={defaultCollapsedDepth}
          openMap={openMap}
          onToggle={togglePath}
          isRoot
        />
      </div>
    </div>
  )
}

type JsonNodeProps = {
  label?: string
  value: unknown
  depth: number
  path: string
  defaultCollapsedDepth: number
  openMap: Record<string, boolean>
  onToggle: (path: string, isOpen: boolean) => void
  isRoot?: boolean
}

function JsonNode({
  label,
  value,
  depth,
  path,
  defaultCollapsedDepth,
  openMap,
  onToggle,
  isRoot = false,
}: JsonNodeProps) {
  const isObjectValue = isObject(value)
  const isArrayValue = Array.isArray(value)
  const canExpand = isObjectValue || isArrayValue

  const defaultOpen = isRoot || depth < defaultCollapsedDepth
  const isOpen = openMap[path] ?? defaultOpen

  if (!canExpand) {
    return (
      <div className={cn("flex gap-2", !isRoot && "pl-5")}>
        {!isRoot && label ? <span className="text-sky-700 dark:text-sky-300">"{label}"</span> : null}
        {!isRoot && label ? <span className="text-muted-foreground">:</span> : null}
        <PrimitiveValue value={value} />
      </div>
    )
  }

  const entries = isArrayValue
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value)

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(path, isOpen)}
        className={cn(
          "flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-muted/60",
          !isRoot && "pl-1",
        )}
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        {!isRoot && label ? (
          <>
            <span className="text-sky-700 dark:text-sky-300">"{label}"</span>
            <span className="text-muted-foreground">:</span>
          </>
        ) : null}
        <span className="text-muted-foreground">
          {isArrayValue ? "[" : "{"}
          <span className="ml-1">{entries.length}</span>
          <span className="ml-1">{isArrayValue ? "items" : "fields"}</span>
          {!isOpen ? <span className="ml-1">{isArrayValue ? "]" : "}"}</span> : null}
        </span>
      </button>

      {isOpen ? (
        <div className="space-y-0.5 pl-5">
          {entries.length === 0 ? (
            <div className="pl-1 text-muted-foreground">{isArrayValue ? "[]" : "{}"}</div>
          ) : (
            entries.map(([childKey, childValue]) => (
              <JsonNode
                key={`${path}.${childKey}`}
                label={isArrayValue ? `[${childKey}]` : childKey}
                value={childValue}
                depth={depth + 1}
                path={`${path}.${childKey}`}
                defaultCollapsedDepth={defaultCollapsedDepth}
                openMap={openMap}
                onToggle={onToggle}
              />
            ))
          )}
          <div className="text-muted-foreground">{isArrayValue ? "]" : "}"}</div>
        </div>
      ) : null}
    </div>
  )
}

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-muted-foreground">null</span>
  }

  if (typeof value === "string") {
    return <span className="break-all text-emerald-700 dark:text-emerald-300">"{value}"</span>
  }

  if (typeof value === "number") {
    return <span className="text-amber-700 dark:text-amber-300">{value}</span>
  }

  if (typeof value === "boolean") {
    return <span className="text-violet-700 dark:text-violet-300">{String(value)}</span>
  }

  return <span className="break-all text-foreground">{String(value)}</span>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
