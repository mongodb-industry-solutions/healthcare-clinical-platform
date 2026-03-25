import { notFound } from "next/navigation"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { PatientDetail } from "@/components/patients/patient-detail"
import { mockPatients, mockVitalsTimeSeries, dashboardStats } from "@/lib/mock-data"

interface PatientPageProps {
  params: Promise<{ patientId: string }>
}

export default async function PatientPage({ params }: PatientPageProps) {
  const { patientId } = await params
  const patient = mockPatients.find((p) => p.patient_id === patientId)

  if (!patient) {
    notFound()
  }

  const vitalsTimeSeries = mockVitalsTimeSeries[patientId] || []

  return (
    <DashboardShell 
      criticalAlerts={dashboardStats.criticalAlerts}
      highAlerts={dashboardStats.highAlerts}
    >
      <PatientDetail patient={patient} vitalsTimeSeries={vitalsTimeSeries} />
    </DashboardShell>
  )
}
