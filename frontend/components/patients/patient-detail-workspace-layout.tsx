"use client"

import * as React from "react"

interface PatientDetailWorkspaceLayoutProps {
  supportRail: React.ReactNode
  workspaceColumn: React.ReactNode
}

export function PatientDetailWorkspaceLayout({
  supportRail,
  workspaceColumn,
}: PatientDetailWorkspaceLayoutProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <aside className="lg:col-span-4 xl:col-span-3 space-y-4">
        {supportRail}
      </aside>
      <main className="lg:col-span-8 xl:col-span-9 min-w-0">
        {workspaceColumn}
      </main>
    </div>
  )
}
