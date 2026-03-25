import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { PatientComparison } from "@/components/compare/patient-comparison"
import { dashboardStats } from "@/lib/mock-data"

export default function ComparePage() {
  return (
    <DashboardShell 
      criticalAlerts={dashboardStats.criticalAlerts}
      highAlerts={dashboardStats.highAlerts}
    >
      <PatientComparison />
    </DashboardShell>
  )
}
