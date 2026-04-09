"use client"

import * as React from "react"
import JsonView from "react18-json-view"
import "react18-json-view/src/style.css"
import "react18-json-view/src/dark.css"

import { cn } from "@/lib/utils"

type JsonTreeViewProps = {
  value: unknown
  /** Controls default collapse depth. Number = collapse at depth > N. true = all collapsed, false = all expanded. */
  collapsed?: number | boolean
  maxHeightClassName?: string
}

export function JsonTreeView({
  value,
  collapsed = 1,
  maxHeightClassName = "max-h-[26rem]",
}: JsonTreeViewProps) {
  return (
    <div
      className={cn(
        "relative max-w-full overflow-auto rounded-lg border bg-muted/20",
        maxHeightClassName,
      )}
    >
      <JsonView
        src={value as Record<string, unknown>}
        collapsed={collapsed}
        theme="atom"
        displaySize="collapsed"
        enableClipboard
        collapseStringsAfterLength={80}
        matchesURL={false}
        style={{
          padding: "12px 12px 12px 16px",
          fontSize: "12px",
          lineHeight: "1.75",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          background: "transparent",
        }}
      />
    </div>
  )
}
