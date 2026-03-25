import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { PatientList } from "@/components/patients/patient-list"
import { dashboardStats } from "@/lib/mock-data"

export default function PatientsPage() {
  return (
    <DashboardShell 
      criticalAlerts={dashboardStats.criticalAlerts}
      highAlerts={dashboardStats.highAlerts}
    >
      <PatientList />
    </DashboardShell>
  )
}
