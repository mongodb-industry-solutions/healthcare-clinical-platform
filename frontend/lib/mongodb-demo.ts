import type { CareGap, Patient360 } from "./mock-data"

export type FieldDiff = {
  path: string
  kind: "added" | "changed" | "removed"
  before?: unknown
  after?: unknown
}

export type MongoActivityCategory =
  | "ingest"
  | "materialize"
  | "alert"
  | "workflow"
  | "care-gap"

export type MongoActivityEvent = {
  id: string
  timestamp: string
  category: MongoActivityCategory
  title: string
  description?: string
  collection: string
  patientId?: string
  patientName?: string
}

export type EvolutionMilestone = {
  id: string
  title: string
  timestamp?: string | null
  diffs: FieldDiff[]
}

export type DataModelSummary = {
  label: string
  description: string
  metrics: Array<{ label: string; value: string }>
}

type KedWorkflow = {
  status?: string
  ordered_at?: string | null
  completed_at?: string | null
  last_updated_at?: string | null
  required_evidence?: string[]
  missing_evidence?: string[]
  latest_result_ids?: string[]
  follow_up_recommended?: boolean
  follow_up_reason?: string | null
}

type Patient360WithWorkflow = Patient360 & {
  interventions?: {
    ked_workflow?: KedWorkflow
  }
}

type EvolutionOptions = {
  alerts?: Patient360["active_alerts"]
  careGaps?: Patient360["care_gaps"]
  workflowStatus?: unknown
  lastRefreshedAt?: string | null
}

const EVENT_CATEGORY_LABELS: Record<MongoActivityCategory, string> = {
  ingest: "Ingest",
  materialize: "Materialize",
  alert: "Alert",
  workflow: "Workflow",
  "care-gap": "Care gap",
}

export function getMongoCategoryLabel(category: MongoActivityCategory) {
  return EVENT_CATEGORY_LABELS[category]
}

export function getMongoCategoryVariant(
  category: MongoActivityCategory,
): "default" | "secondary" | "outline" | "destructive" {
  switch (category) {
    case "alert":
      return "destructive"
    case "workflow":
      return "default"
    case "care-gap":
      return "secondary"
    case "materialize":
      return "outline"
    case "ingest":
    default:
      return "secondary"
  }
}

export function formatMongoTimestamp(timestamp?: string | null) {
  if (!timestamp) return "Pending"
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return "Pending"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function formatMongoRelativeTime(timestamp?: string | null) {
  if (!timestamp) return "Pending"

  const deltaMs = Date.now() - new Date(timestamp).getTime()
  if (!Number.isFinite(deltaMs)) return "Pending"

  const seconds = Math.max(0, Math.floor(deltaMs / 1000))
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function summarizeFhirBundle(bundle: unknown | null): DataModelSummary {
  if (!bundle || typeof bundle !== "object") {
    return {
      label: "FHIR Bundle",
      description: "Raw interoperable source data is not available in the current detail response.",
      metrics: [
        { label: "Availability", value: "Unavailable" },
        { label: "Source format", value: "FHIR Bundle" },
      ],
    }
  }

  const entry = getRecord(bundle).entry
  const entries = Array.isArray(entry) ? entry : []
  const resourceTypes = Array.from(
    new Set(
      entries
        .map((item) => {
          if (!item || typeof item !== "object") return null
          const resource = getRecord(item).resource
          if (!resource || typeof resource !== "object") return null
          const type = getRecord(resource).resourceType
          return typeof type === "string" ? type : null
        })
        .filter((value): value is string => Boolean(value)),
    ),
  )

  const bundleRecord = getRecord(bundle)

  return {
    label: "FHIR Bundle",
    description: "Interoperable records as received before they are shaped into operational application data.",
    metrics: [
      {
        label: "Bundle type",
        value:
          typeof bundleRecord.type === "string"
            ? bundleRecord.type
            : typeof bundleRecord.resourceType === "string"
              ? bundleRecord.resourceType
              : "Unknown",
      },
      { label: "Entries", value: String(entries.length) },
      {
        label: "Resource types",
        value: resourceTypes.length > 0 ? resourceTypes.slice(0, 4).join(", ") : "Unknown",
      },
    ],
  }
}

export function summarizePatient360(patient: Patient360): DataModelSummary {
  const openCareGapCount = patient.care_gaps.filter((gap) => gap.status === "open").length

  return {
    label: "Patient 360",
    description: "Operational patient document curated for risk review, workflow state, and care-gap action.",
    metrics: [
      { label: "Patient", value: patient.demographics.name },
      { label: "Active alerts", value: String(patient.active_alerts.length) },
      { label: "Open care gaps", value: String(openCareGapCount) },
      {
        label: "Last refreshed",
        value: formatMongoTimestamp(patient.vitals_summary?.refreshed_at ?? patient.updated_at),
      },
    ],
  }
}

export function buildDashboardMongoActivity(patients: Patient360[]) {
  return sortEvents(
    patients
      .flatMap((patient) => buildPatientMongoActivity(patient))
      .filter((event) => event.category !== "ingest"),
  ).slice(0, 18)
}

export function buildCareGapMongoActivity(patients: Patient360[]) {
  return sortEvents(
    patients
      .flatMap((patient) => buildPatientMongoActivity(patient))
      .filter((event) => event.category === "workflow" || event.category === "care-gap"),
  ).slice(0, 18)
}

export function buildPatientMongoActivity(patient: Patient360) {
  const extendedPatient = patient as Patient360WithWorkflow
  const workflow = getKedWorkflow(extendedPatient)
  const kedGap = getKedGap(patient.care_gaps)
  const patientName = patient.demographics.name
  const events: MongoActivityEvent[] = []

  events.push({
    id: `${patient.patient_id}-ingest`,
    timestamp: patient.created_at,
    category: "ingest",
    title: "FHIR bundle ingested",
    description: "Interoperable source records became available for clinical materialization.",
    collection: "fhir_bundles",
    patientId: patient.patient_id,
    patientName,
  })

  const materializedAt = patient.vitals_summary?.refreshed_at ?? patient.updated_at
  if (materializedAt) {
    events.push({
      id: `${patient.patient_id}-materialize`,
      timestamp: materializedAt,
      category: "materialize",
      title: "Patient 360 materialized",
      description: "Operational vitals, alerts, and care-gap context were refreshed for review.",
      collection: "patient_360",
      patientId: patient.patient_id,
      patientName,
    })
  }

  patient.active_alerts.forEach((alert) => {
    if (!alert.created_at) return

    events.push({
      id: `${patient.patient_id}-alert-${alert.alert_id}`,
      timestamp: alert.created_at,
      category: "alert",
      title: alert.title,
      description: alert.reasoning,
      collection: "alerts",
      patientId: patient.patient_id,
      patientName,
    })
  })

  const orderedAt = workflow?.ordered_at
  if (workflow && workflow.status && workflow.status !== "not_started" && orderedAt) {
    events.push({
      id: `${patient.patient_id}-workflow-ordered`,
      timestamp: orderedAt,
      category: "workflow",
      title: "KED workflow ordered",
      description: "Kidney evaluation evidence was requested for the open diabetic kidney care gap.",
      collection: "interventions",
      patientId: patient.patient_id,
      patientName,
    })
  }

  const evidenceReceived = kedGap?.closure_evidence?.received ?? []
  const evidenceTimestamp =
    workflow?.completed_at ??
    workflow?.last_updated_at ??
    patient.updated_at

  if (evidenceReceived.length > 0 && evidenceTimestamp) {
    events.push({
      id: `${patient.patient_id}-kidney-evidence`,
      timestamp: evidenceTimestamp,
      category: "workflow",
      title: "Kidney lab evidence appended",
      description: `Evidence received: ${evidenceReceived.join(", ")}.`,
      collection: "patient_360",
      patientId: patient.patient_id,
      patientName,
    })
  }

  if (kedGap?.status === "closed" && kedGap.closure_evidence?.closed_at) {
    events.push({
      id: `${patient.patient_id}-ked-gap-closed`,
      timestamp: kedGap.closure_evidence.closed_at,
      category: "care-gap",
      title: "KED care gap closed",
      description: "Required evidence was recorded and the diabetic kidney evaluation gap was closed.",
      collection: "care_gaps",
      patientId: patient.patient_id,
      patientName,
    })
  }

  return sortEvents(events)
}

export function buildPatientEvolution(
  patient: Patient360,
  options: EvolutionOptions = {},
) {
  const activeAlerts = options.alerts ?? patient.active_alerts
  const careGaps = options.careGaps ?? patient.care_gaps
  const refreshedAt = options.lastRefreshedAt ?? patient.vitals_summary?.refreshed_at ?? null
  const workflow = getKedWorkflow(patient as Patient360WithWorkflow)
  const workflowState =
    normalizeWorkflowStatus(options.workflowStatus) ??
    workflow?.status ??
    getKedGap(careGaps)?.workflow_status ??
    "not_started"

  const milestones: EvolutionMilestone[] = []

  milestones.push({
    id: "initialized",
    title: "Patient 360 initialized",
    timestamp: patient.created_at,
    diffs: [
      { path: "demographics.name", kind: "added", after: patient.demographics.name },
      { path: "profile_type", kind: "added", after: patient.profile_type },
      { path: "source_hospital", kind: "added", after: patient.hospital_name },
      {
        path: "conditions",
        kind: "added",
        after: `${patient.conditions.length} active conditions`,
      },
    ],
  })

  if (refreshedAt) {
    milestones.push({
      id: "vitals-refreshed",
      title: "Vitals summary refreshed",
      timestamp: refreshedAt,
      diffs: [
        {
          path: "vitals_summary.latest",
          kind: "changed",
          before: "Prior summary",
          after: patient.vitals_summary.latest,
        },
        {
          path: "vitals_summary.trend_24h",
          kind: "changed",
          before: "Prior trend window",
          after: patient.vitals_summary.trend_24h,
        },
        {
          path: "vitals_summary.refreshed_at",
          kind: "changed",
          before: "Previous refresh",
          after: refreshedAt,
        },
      ],
    })
  }

  const thresholdDiffs = Object.entries(patient.personalized_thresholds)
    .filter(([, value]) => Boolean(value?.source_rule))
    .map(([key, value]) => ({
      path: `personalized_thresholds.${key}`,
      kind: "changed" as const,
      before: "Default threshold range",
      after: value,
    }))

  if (thresholdDiffs.length > 0) {
    milestones.push({
      id: "thresholds-personalized",
      title: "Thresholds personalized",
      timestamp: refreshedAt ?? patient.updated_at,
      diffs: thresholdDiffs.slice(0, 4),
    })
  }

  const latestAlert = [...activeAlerts]
    .filter((alert) => Boolean(alert.created_at))
    .sort((left, right) => toTimestamp(right.created_at) - toTimestamp(left.created_at))[0]

  if (latestAlert) {
    milestones.push({
      id: "alert-added",
      title: "Alert added",
      timestamp: latestAlert.created_at,
      diffs: [
        { path: "active_alerts.title", kind: "added", after: latestAlert.title },
        {
          path: "active_alerts.count",
          kind: "changed",
          before: Math.max(activeAlerts.length - 1, 0),
          after: activeAlerts.length,
        },
        { path: "active_alerts.status", kind: "added", after: latestAlert.status },
      ],
    })
  }

  const kedGap = getKedGap(careGaps)
  const workflowTimestamp =
    workflow?.completed_at ??
    workflow?.last_updated_at ??
    workflow?.ordered_at ??
    refreshedAt ??
    patient.updated_at

  if (workflowState !== "not_started" || workflow?.follow_up_recommended || kedGap?.workflow_status) {
    milestones.push({
      id: "ked-workflow-updated",
      title: "KED workflow updated",
      timestamp: workflowTimestamp,
      diffs: [
        {
          path: "interventions.ked_workflow.status",
          kind: "changed",
          before: "not_started",
          after: workflowState,
        },
        {
          path: "care_gaps.KED.workflow_status",
          kind: "changed",
          before: "not_started",
          after: kedGap?.workflow_status ?? workflowState,
        },
        {
          path: "care_gaps.KED.closure_evidence.received",
          kind: "changed",
          before: [],
          after: kedGap?.closure_evidence?.received ?? [],
        },
      ],
    })
  }

  const careGapWithUpdate = careGaps.find(
    (gap) =>
      gap.status === "closed" ||
      (gap.closure_evidence?.received?.length ?? 0) > 0 ||
      Boolean(gap.follow_up?.recommended),
  )

  if (careGapWithUpdate) {
    milestones.push({
      id: "care-gap-status-updated",
      title: "Care gap status updated",
      timestamp:
        careGapWithUpdate.closure_evidence?.closed_at ??
        workflowTimestamp ??
        patient.updated_at,
      diffs: [
        {
          path: `care_gaps.${careGapWithUpdate.hedis_measure}.status`,
          kind: "changed",
          before: careGapWithUpdate.status === "closed" ? "open" : "pending",
          after: careGapWithUpdate.status,
        },
        {
          path: `care_gaps.${careGapWithUpdate.hedis_measure}.closure_evidence.received`,
          kind: "changed",
          before: [],
          after: careGapWithUpdate.closure_evidence?.received ?? [],
        },
        {
          path: `care_gaps.${careGapWithUpdate.hedis_measure}.follow_up`,
          kind: "changed",
          before: "Not assessed",
          after: careGapWithUpdate.follow_up ?? "No follow-up action",
        },
      ],
    })
  }

  return milestones.filter((milestone) => milestone.diffs.length > 0)
}

function sortEvents(events: MongoActivityEvent[]) {
  return [...events].sort((left, right) => toTimestamp(right.timestamp) - toTimestamp(left.timestamp))
}

function getKedWorkflow(patient: Patient360WithWorkflow) {
  return patient.interventions?.ked_workflow ?? null
}

function getKedGap(careGaps: CareGap[]) {
  return careGaps.find((gap) => gap.hedis_measure === "KED") ?? null
}

function normalizeWorkflowStatus(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function toTimestamp(value?: string | null) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}
