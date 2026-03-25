import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { PatientDetail } from "@/components/patients/patient-detail"

interface PatientPageProps {
  params: Promise<{ patientId: string }>
}

export default async function PatientPage({ params }: PatientPageProps) {
  const { patientId } = await params

  return (
    <DashboardShell>
      <PatientDetail patientId={patientId} />
    </DashboardShell>
  )
}
