import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { AlertsView } from "@/components/alerts/alerts-view"
import { dashboardStats } from "@/lib/mock-data"

export default function AlertsPage() {
  return (
    <DashboardShell 
      criticalAlerts={dashboardStats.criticalAlerts}
      highAlerts={dashboardStats.highAlerts}
    >
      <AlertsView />
    </DashboardShell>
  )
}
