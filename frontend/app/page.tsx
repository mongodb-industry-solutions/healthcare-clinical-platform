import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { DashboardOverview } from "@/components/dashboard/dashboard-overview"
import { dashboardStats } from "@/lib/mock-data"

export default function DashboardPage() {
  return (
    <DashboardShell 
      criticalAlerts={dashboardStats.criticalAlerts}
      highAlerts={dashboardStats.highAlerts}
    >
      <DashboardOverview />
    </DashboardShell>
  )
}
