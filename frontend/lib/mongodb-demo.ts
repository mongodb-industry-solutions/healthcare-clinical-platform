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
  description: string
  timestamp?: string | null
  documentBefore: Record<string, unknown>
  documentAfter: Record<string, unknown>
}

export type DataModelSummary = {
  label: string
  description: string
  metrics: Array<{ label: string; value: string }>
}

type FollowUpSummary = {
  title?: string
  summary?: string
  recommendations?: string[]
  based_on?: Record<string, unknown>
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
  follow_up_summary?: FollowUpSummary | null
}

type Patient360WithWorkflow = Patient360 & {
  interventions?: {
    ked_workflow?: KedWorkflow
    cdc_hba_workflow?: KedWorkflow
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

  const evidenceReceived = kedGap?.evidence?.found ?? []
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

  if (kedGap?.status === "closed" && kedGap.last_completed) {
    events.push({
      id: `${patient.patient_id}-ked-gap-closed`,
      timestamp: kedGap.last_completed,
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
  const careGaps = options.careGaps ?? patient.care_gaps
  const refreshedAt = options.lastRefreshedAt ?? patient.vitals_summary?.refreshed_at ?? null
  const workflow = getKedWorkflow(patient as Patient360WithWorkflow)
  const workflowState =
    normalizeWorkflowStatus(options.workflowStatus) ??
    workflow?.status ??
    getKedGap(careGaps)?.workflow_status ??
    "not_started"

  const milestones: EvolutionMilestone[] = []
  const oid = fakeObjectId(patient.patient_id)

  const stubDoc = buildStubSnapshot(patient, oid)
  const personalizedDoc = buildPersonalizedSnapshot(patient, oid)
  const vitalsDoc = buildWithVitalsSnapshot(patient, personalizedDoc)
  const thresholdsDoc = buildWithThresholdsSnapshot(patient, vitalsDoc)

  const kedGap = getKedGap(careGaps)
  const workflowTimestamp =
    workflow?.completed_at ??
    workflow?.last_updated_at ??
    workflow?.ordered_at ??
    refreshedAt ??
    patient.updated_at

  milestones.push({
    id: "personalized",
    title: "Patient 360 personalized",
    description:
      "FHIR data materialized into a rich, query-ready patient document with nested demographics, typed conditions, and computed clinical flags — no fixed schema required.",
    timestamp: patient.created_at,
    documentBefore: stubDoc,
    documentAfter: personalizedDoc,
  })

  if (refreshedAt) {
    milestones.push({
      id: "vitals-refreshed",
      title: "Vitals summary refreshed",
      description:
        "Real-time vitals embedded directly into the patient document as nested summaries with trends, enabling single-query clinical lookups.",
      timestamp: refreshedAt,
      documentBefore: personalizedDoc,
      documentAfter: vitalsDoc,
    })
  }

  const activeThresholds = Object.entries(patient.personalized_thresholds)
    .filter(([, value]) => Boolean(value?.source_rule))

  if (activeThresholds.length > 0) {
    milestones.push({
      id: "thresholds-personalized",
      title: "Thresholds personalized",
      description:
        "CDS engine evaluated patient conditions and embedded personalized alert thresholds, each linked to the source rule that generated them.",
      timestamp: refreshedAt ?? patient.updated_at,
      documentBefore: vitalsDoc,
      documentAfter: thresholdsDoc,
    })
  }

  if (workflowState !== "not_started" || workflow?.follow_up_recommended || kedGap?.workflow_status) {
    const kedBefore = { ...thresholdsDoc }
    const kedAfter = buildWithKedWorkflowSnapshot(
      thresholdsDoc, workflowState, kedGap, workflow,
    )

    milestones.push({
      id: "ked-workflow-updated",
      title: "KED workflow updated",
      description:
        "Kidney evaluation workflow state, evidence tracking, and care gap closure data embedded as the clinical workflow progressed.",
      timestamp: workflowTimestamp,
      documentBefore: kedBefore,
      documentAfter: kedAfter,
    })
  }

  const cdcHbaGap = getCdcHbaGap(careGaps)
  const cdcHbaWorkflow = getCdcHbaWorkflow(patient as Patient360WithWorkflow)
  const cdcHbaState = cdcHbaWorkflow?.status ?? cdcHbaGap?.workflow_status ?? "not_started"

  if (cdcHbaState !== "not_started" || cdcHbaWorkflow?.follow_up_recommended || cdcHbaGap?.workflow_status) {
    const cdcTimestamp =
      cdcHbaWorkflow?.completed_at ??
      cdcHbaWorkflow?.last_updated_at ??
      cdcHbaWorkflow?.ordered_at ??
      refreshedAt ??
      patient.updated_at

    const cdcBefore = { ...thresholdsDoc }
    const cdcAfter = buildWithCdcHbaWorkflowSnapshot(
      thresholdsDoc, cdcHbaState, cdcHbaGap, cdcHbaWorkflow,
    )

    milestones.push({
      id: "cdc-hba-workflow-updated",
      title: "CDC-HBA workflow updated",
      description:
        "HbA1c workflow state and evidence embedded alongside existing data, demonstrating the document's ability to grow with clinical activity.",
      timestamp: cdcTimestamp,
      documentBefore: cdcBefore,
      documentAfter: cdcAfter,
    })
  }

  return milestones
}

function fakeObjectId(patientId: string): string {
  const num = patientId.replace(/\D/g, "") || "0"
  return `65a1b2c3d4e5f6${num.padStart(10, "0")}`
}

function buildStubSnapshot(
  patient: Patient360,
  oid: string,
): Record<string, unknown> {
  return {
    _id: `ObjectId('${oid}')`,
    patient_id: patient.patient_id,
    mrn: patient.mrn,
    source_hospital: patient.source_hospital,
    created_at: patient.created_at,
  }
}

function buildPersonalizedSnapshot(
  patient: Patient360,
  oid: string,
): Record<string, unknown> {
  return {
    _id: `ObjectId('${oid}')`,
    patient_id: patient.patient_id,
    mrn: patient.mrn,
    source_hospital: patient.source_hospital,
    hospital_name: patient.hospital_name,
    profile_type: patient.profile_type,
    demographics: {
      name: patient.demographics.name,
      given: patient.demographics.given,
      family: patient.demographics.family,
      gender: patient.demographics.gender,
      birth_date: patient.demographics.birth_date,
      age: patient.demographics.age,
    },
    conditions: patient.conditions.slice(0, 3).map((c) => ({
      icd10: c.icd10,
      display: c.display,
      clinical_status: c.clinical_status,
    })),
    flags: {
      has_beta_blocker: patient.flags.has_beta_blocker,
      has_insulin: patient.flags.has_insulin,
      has_ckd: patient.flags.has_ckd,
      condition_codes: patient.flags.condition_codes.slice(0, 3),
    },
    created_at: patient.created_at,
  }
}

function buildWithVitalsSnapshot(
  patient: Patient360,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const { created_at, ...rest } = base
  return {
    ...rest,
    vitals_summary: {
      latest: {
        heart_rate: patient.vitals_summary.latest.heart_rate,
        respiratory_rate: patient.vitals_summary.latest.respiratory_rate,
        temperature: patient.vitals_summary.latest.temperature,
        spo2: patient.vitals_summary.latest.spo2,
        activity_level: patient.vitals_summary.latest.activity_level,
      },
      trend_24h: patient.vitals_summary.trend_24h,
      refreshed_at: patient.vitals_summary.refreshed_at,
    },
    created_at,
  }
}

function buildWithThresholdsSnapshot(
  patient: Patient360,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const { created_at, ...rest } = base
  const thresholds: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patient.personalized_thresholds)) {
    if (value?.source_rule) {
      thresholds[key] = { low: value.low, high: value.high, source_rule: value.source_rule }
    }
  }

  if (Object.keys(thresholds).length === 0) return { ...base }

  return {
    ...rest,
    personalized_thresholds: thresholds,
    created_at,
  }
}

function buildWithKedWorkflowSnapshot(
  base: Record<string, unknown>,
  workflowState: string,
  kedGap: CareGap | null,
  workflow: KedWorkflow | null,
): Record<string, unknown> {
  const { created_at, ...rest } = base
  const kedWorkflow: Record<string, unknown> = {
    status: workflowState,
  }
  if (workflow?.ordered_at) kedWorkflow.ordered_at = workflow.ordered_at
  if (workflow?.completed_at) kedWorkflow.completed_at = workflow.completed_at
  if (workflow?.required_evidence) kedWorkflow.required_evidence = workflow.required_evidence
  if (workflow?.latest_result_ids?.length) kedWorkflow.latest_result_ids = workflow.latest_result_ids

  const followUp = workflow?.follow_up_summary
  if (followUp?.title) {
    kedWorkflow.follow_up_summary = {
      title: followUp.title,
      summary: followUp.summary,
      recommendations: followUp.recommendations,
    }
  }

  const careGapEntry: Record<string, unknown> = {
    hedis_measure: "KED",
    status: kedGap?.status ?? "open",
    workflow_status: kedGap?.workflow_status ?? workflowState,
    evidence: kedGap?.evidence ?? { found: [], missing: [], source_resources: [] },
    reason: kedGap?.reason ?? null,
    recommended_action: kedGap?.recommended_action ?? null,
  }

  return {
    ...rest,
    interventions: { ked_workflow: kedWorkflow },
    care_gaps: [careGapEntry],
    created_at,
  }
}

function buildWithCdcHbaWorkflowSnapshot(
  base: Record<string, unknown>,
  workflowState: string,
  cdcGap: CareGap | null,
  workflow: KedWorkflow | null,
): Record<string, unknown> {
  const { created_at, ...rest } = base
  const cdcWorkflow: Record<string, unknown> = {
    status: workflowState,
  }
  if (workflow?.ordered_at) cdcWorkflow.ordered_at = workflow.ordered_at
  if (workflow?.completed_at) cdcWorkflow.completed_at = workflow.completed_at
  if (workflow?.required_evidence) cdcWorkflow.required_evidence = workflow.required_evidence
  if (workflow?.latest_result_ids?.length) cdcWorkflow.latest_result_ids = workflow.latest_result_ids

  const followUp = workflow?.follow_up_summary
  if (followUp?.title) {
    cdcWorkflow.follow_up_summary = {
      title: followUp.title,
      summary: followUp.summary,
      recommendations: followUp.recommendations,
    }
  }

  const careGapEntry: Record<string, unknown> = {
    hedis_measure: "CDC-HBA",
    status: cdcGap?.status ?? "open",
    workflow_status: cdcGap?.workflow_status ?? workflowState,
    evidence: cdcGap?.evidence ?? { found: [], missing: [], source_resources: [] },
    reason: cdcGap?.reason ?? null,
    recommended_action: cdcGap?.recommended_action ?? null,
  }

  return {
    ...rest,
    interventions: { cdc_hba_workflow: cdcWorkflow },
    care_gaps: [careGapEntry],
    created_at,
  }
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

function getCdcHbaGap(careGaps: CareGap[]) {
  return careGaps.find((gap) => gap.hedis_measure === "CDC-HBA") ?? null
}

function getCdcHbaWorkflow(patient: Patient360WithWorkflow) {
  return patient.interventions?.cdc_hba_workflow ?? null
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
