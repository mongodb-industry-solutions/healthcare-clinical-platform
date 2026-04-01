import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { AlertsView } from "@/components/alerts/alerts-view"

export default function AlertsPage() {
  return (
    <DashboardShell>
      <AlertsView />
    </DashboardShell>
  )
}
