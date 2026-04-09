"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ClipboardList } from "lucide-react"
import type { FollowUpSummaryResponse } from "@/lib/api"

interface KedFollowUpSummaryProps {
  summary: FollowUpSummaryResponse
}

export function KedFollowUpSummary({ summary }: KedFollowUpSummaryProps) {
  return (
    <Card className="gap-0 py-4 border-amber-200 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex items-center gap-2 px-5">
        <ClipboardList className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-sm font-semibold">{summary.title}</p>
      </div>
      <div className="px-5 pt-2 space-y-3">
        <p className="text-sm leading-relaxed">{summary.summary}</p>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            Recommendations
          </p>
          <ul className="space-y-1.5">
            {summary.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Badge
                  variant="outline"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-full p-0 text-[10px] flex items-center justify-center"
                >
                  {i + 1}
                </Badge>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}
