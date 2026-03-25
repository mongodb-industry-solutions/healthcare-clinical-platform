import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { PatientComparison } from "@/components/compare/patient-comparison"

export default function ComparePage() {
  return (
    <DashboardShell>
      <PatientComparison />
    </DashboardShell>
  )
}
