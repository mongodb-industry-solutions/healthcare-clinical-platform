import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { VitalsMonitor } from "@/components/vitals/vitals-monitor"

export default function VitalsPage() {
  return (
    <DashboardShell>
      <VitalsMonitor />
    </DashboardShell>
  )
}
