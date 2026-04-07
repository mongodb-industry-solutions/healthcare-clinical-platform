import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { DashboardOverview } from "@/components/dashboard/dashboard-overview"

export default function DashboardPage() {
  return (
    <DashboardShell hideTopBar>
      <DashboardOverview />
    </DashboardShell>
  )
}
