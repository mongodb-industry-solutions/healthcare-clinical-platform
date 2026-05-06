import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { CareGapsView } from "@/components/care-gaps/care-gaps-view"

export default function CareGapsPage() {
  return (
    <DashboardShell>
      <CareGapsView />
    </DashboardShell>
  )
}
