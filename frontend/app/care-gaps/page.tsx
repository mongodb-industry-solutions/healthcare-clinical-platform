import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { CareGapsView } from "@/components/care-gaps/care-gaps-view"
import { dashboardStats } from "@/lib/mock-data"

export default function CareGapsPage() {
  return (
    <DashboardShell 
      criticalAlerts={dashboardStats.criticalAlerts}
      highAlerts={dashboardStats.highAlerts}
    >
      <CareGapsView />
    </DashboardShell>
  )
}
