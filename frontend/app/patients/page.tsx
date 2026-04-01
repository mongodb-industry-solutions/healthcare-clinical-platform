import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { PatientList } from "@/components/patients/patient-list"

export default function PatientsPage() {
  return (
    <DashboardShell>
      <PatientList />
    </DashboardShell>
  )
}
