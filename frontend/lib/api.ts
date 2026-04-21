/**
 * API client for the Leafy Health FastAPI backend.
 *
 * Endpoints used:
 *   /materializer/patients          — Full Patient 360 documents
 *   /dashboard/patients             — Compact patient list with risk scores
 *   /dashboard/patients/{id}        — Enriched patient detail
 *   /dashboard/patients/{id}/vitals — Vitals time series with thresholds
 *   /dashboard/search               — Patient search
 */

import type { Patient360, VitalsTimeSeries } from "./mock-data"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Full Patient 360 list (for dashboard, alerts, care-gaps, compare)
// ---------------------------------------------------------------------------

export async function fetchAllPatients(params?: {
  hospital?: string
  profile_type?: string
  limit?: number
}): Promise<Patient360[]> {
  const qs = new URLSearchParams()
  if (params?.hospital) qs.set("hospital", params.hospital)
  if (params?.profile_type) qs.set("profile_type", params.profile_type)
  qs.set("limit", String(params?.limit ?? 500))
  return apiFetch<Patient360[]>(`/materializer/patients?${qs}`)
}

// ---------------------------------------------------------------------------
// Dashboard patient list (compact summaries with risk score)
// ---------------------------------------------------------------------------

export interface PatientSummary {
  patient_id: string
  mrn: string
  name: string
  age: number
  gender: string
  source_hospital: string
  hospital_name: string
  profile_type: string
  alert_count: number
  max_severity: string | null
  care_gap_count: number
  latest_hr: number | null
  latest_rr: number | null
  latest_spo2: number | null
  latest_temp: number | null
  risk_score: number
}

export interface PatientListResponse {
  total: number
  patients: PatientSummary[]
}

export async function fetchPatientList(params?: {
  hospital?: string
  profile_type?: string
  sort_by?: string
  limit?: number
  skip?: number
}): Promise<PatientListResponse> {
  const qs = new URLSearchParams()
  if (params?.hospital) qs.set("hospital", params.hospital)
  if (params?.profile_type) qs.set("profile_type", params.profile_type)
  if (params?.sort_by) qs.set("sort_by", params.sort_by)
  qs.set("limit", String(params?.limit ?? 50))
  qs.set("skip", String(params?.skip ?? 0))
  return apiFetch<PatientListResponse>(`/dashboard/patients?${qs}`)
}

// ---------------------------------------------------------------------------
// Patient detail (enriched Patient 360)
// ---------------------------------------------------------------------------

export interface ThresholdBreach {
  vital: string
  current_value: number | null
  threshold: number | null
  breached: boolean
  direction: string | null
}

export interface PatientDetailResponse {
  patient: Patient360
  risk_score: number
  time_since_last_alert: string | null
  threshold_breaches: ThresholdBreach[]
}

export async function fetchPatientDetail(
  patientId: string,
): Promise<PatientDetailResponse> {
  return apiFetch<PatientDetailResponse>(`/dashboard/patients/${patientId}`)
}

export interface PatientFhirBundleResponse {
  patient_id: string
  available: boolean
  bundle: unknown | null
}

export async function fetchPatientFhirBundle(
  patientId: string,
): Promise<PatientFhirBundleResponse> {
  return apiFetch<PatientFhirBundleResponse>(
    `/dashboard/patients/${patientId}/fhir-bundle`,
  )
}

// ---------------------------------------------------------------------------
// Vitals time series with thresholds
// ---------------------------------------------------------------------------

export interface VitalsWithContextResponse {
  patient_id: string
  readings: VitalsTimeSeries[]
  thresholds: Record<string, { low: number; high: number; source_rule: string | null }>
  total_readings: number
  hours: number
}

export async function fetchPatientVitals(
  patientId: string,
  hours: number = 24,
): Promise<VitalsWithContextResponse> {
  return apiFetch<VitalsWithContextResponse>(
    `/dashboard/patients/${patientId}/vitals?hours=${hours}`,
  )
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  patient_id: string
  mrn: string
  name: string
  age: number
  gender: string
  source_hospital: string
  match_field: string
  match_value: string
}

export interface SearchResponse {
  query: string
  total: number
  results: SearchResult[]
}

export async function searchPatients(
  query: string,
  limit: number = 20,
): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q: query, limit: String(limit) })
  return apiFetch<SearchResponse>(`/dashboard/search?${qs}`)
}

// ---------------------------------------------------------------------------
// Seed pipeline (mirrors backend/scripts/seed_demo.py)
// ---------------------------------------------------------------------------

export interface GeneratePatientsParams {
  count: number
  profile_type: string
  seed?: number
}

export interface GeneratePatientsResult {
  generated: number
  patient_ids: string[]
}

export async function generatePatients(
  params: GeneratePatientsParams,
): Promise<GeneratePatientsResult> {
  return apiFetch<GeneratePatientsResult>("/synthetic/patients/generate", {
    method: "POST",
    body: JSON.stringify(params),
  })
}

export interface GenerateVitalsParams {
  pattern: string
  hours: number
  interval_minutes: number
}

export interface GenerateVitalsResult {
  patient_id: string
  readings_written: number
}

export async function generateVitals(
  patientId: string,
  params: GenerateVitalsParams,
): Promise<GenerateVitalsResult> {
  return apiFetch<GenerateVitalsResult>(
    `/synthetic/vitals/${patientId}/generate`,
    { method: "POST", body: JSON.stringify(params) },
  )
}

export async function materializeAll(): Promise<{
  materialized: number
  total_patients: number
  errors: string[]
}> {
  return apiFetch("/materializer/patients/materialize", { method: "POST" })
}

export async function materializePatient(
  patientId: string,
): Promise<{ patient_id: string; status: string; vitals_readings_used: number }> {
  return apiFetch(`/materializer/patients/${patientId}/materialize`, { method: "POST" })
}

export async function seedCdsRules(): Promise<{
  inserted: number
  rules: string[]
}> {
  return apiFetch("/cds/rules/seed", { method: "POST" })
}

export async function seedAttributions(): Promise<{
  total_patients: number
  attributions_created: number
  errors: string[]
}> {
  return apiFetch("/attribution/seed", { method: "POST" })
}

export async function computeThresholds(
  patientId: string,
): Promise<Record<string, unknown>> {
  return apiFetch(`/cds/thresholds/${patientId}`, { method: "POST" })
}

export async function evaluateAllCds(): Promise<{
  evaluated: number
  total_patients: number
  total_alerts: number
  errors: string[]
}> {
  return apiFetch("/cds/evaluate", { method: "POST" })
}

export async function evaluatePatientCds(
  patientId: string,
): Promise<{ patient_id: string; alerts_generated: number }> {
  return apiFetch(`/cds/evaluate/${patientId}`, { method: "POST" })
}

export async function computeCareGaps(): Promise<{
  processed: number
  total_patients: number
  total_gaps_found: number
  errors: string[]
}> {
  return apiFetch("/cds/care-gaps", { method: "POST" })
}

export async function computePatientCareGaps(
  patientId: string,
): Promise<Record<string, unknown>[]> {
  return apiFetch(`/cds/care-gaps/${patientId}`, { method: "POST" })
}

export async function getStatus(): Promise<{
  patients: number
  vitals_readings: number
  fhir_resources: number
}> {
  return apiFetch("/synthetic/status")
}

export async function getCdsStatus(): Promise<{
  cds_rules_count: number
  alerts_count: number
}> {
  return apiFetch("/cds/status")
}

export async function resetData(): Promise<{ deleted_patients: number; deleted_vitals: number }> {
  return apiFetch("/synthetic/reset?confirm=true", { method: "DELETE" })
}

// ---------------------------------------------------------------------------
// Longitudinal trend analysis
// ---------------------------------------------------------------------------

export interface VitalStats {
  avg: number
  min: number
  max: number
  std: number
}

export interface AlertFrequency {
  critical: number
  high: number
  moderate: number
  low: number
}

export interface WorkbenchStatus {
  title: string
  tone: "critical" | "high" | "moderate" | "stable"
  description: string
}

export interface RecommendedAction {
  title: string
  description: string
  source: string | null
}

export interface BaselineVitalDelta {
  vital: string
  label: string
  unit: string
  current_value: number
  baseline_value: number
  delta: number
  direction: "up" | "down" | "flat"
  significance: "high" | "moderate" | "low"
}

export interface ThresholdBreachStatus {
  vital: string
  current_value: number | null
  threshold: number | null
  breached: boolean
  direction: string | null
}

export interface LongitudinalSnapshot {
  period_key: string
  label: string
  reference_date: string
  vitals_summary: Record<string, VitalStats>
  risk_score: number
  alert_frequency: AlertFrequency
  trend_vs_previous: string
  conditions_active: number
  medications_active: number
  notes: string
  source: "historical" | "live"
  readings_analyzed: number
}

export interface EvidenceItem {
  category: "threshold_breach" | "baseline_drift" | "alert" | "care_gap" | "trend"
  description: string
  vital: string | null
  source_rule: string | null
  significance: "high" | "moderate" | "low"
}

export interface ChronicContextFactor {
  factor: string
  clinical_impact: string
  relevant_vitals: string[]
  source_flag: string
}

export interface CareGapContext {
  hedis_measure: string
  measure_name: string
  status: string
  days_overdue: number
  priority_reason: string
  wearable_correlation: string | null
}

export interface TrajectoryAssessment {
  direction: "deteriorating" | "improving" | "stable" | "fluctuating"
  confidence: "high" | "moderate" | "low"
  summary: string
  key_transitions: string[]
}

export interface LongitudinalResponse {
  patient_id: string
  patient_name: string
  profile_type: string
  current_thresholds: Record<string, { low: number; high: number; source_rule: string | null }>
  snapshots: LongitudinalSnapshot[]
  selected_baseline_key: string | null
  selected_baseline_label: string | null
  baseline_risk_delta: number | null
  baseline_alert_delta: number | null
  current_status: WorkbenchStatus | null
  threshold_breaches: ThresholdBreachStatus[]
  top_risk_drivers: string[]
  clinical_summary: string | null
  baseline_vital_deltas: BaselineVitalDelta[]
  recommended_actions: RecommendedAction[]
  urgency_reason: string | null
  evidence: EvidenceItem[]
  chronic_context: ChronicContextFactor[]
  care_gap_context: CareGapContext[]
  trajectory_assessment: TrajectoryAssessment | null
  workflow_recommendation: string | null
  confidence: "high" | "moderate" | "low" | null
  aggregation_ms: number | null
  pipeline_display: string | null
}

export async function fetchLongitudinal(
  patientId: string,
  baselinePeriodKey?: string | null,
): Promise<LongitudinalResponse> {
  const qs = new URLSearchParams()
  if (baselinePeriodKey) qs.set("baseline_period_key", baselinePeriodKey)
  return apiFetch<LongitudinalResponse>(
    `/dashboard/patients/${patientId}/longitudinal${qs.size ? `?${qs}` : ""}`,
  )
}

// ---------------------------------------------------------------------------
// Population care-gap metrics
// ---------------------------------------------------------------------------

export interface CareGapMeasureMetric {
  hedis_measure: string
  measure_name: string
  applicable_count: number
  open: number
  closed_controlled: number
  closed_uncontrolled: number
  due_soon: number
  open_pct: number
  avg_days_overdue: number
  max_days_overdue: number
}

export interface CareGapPriorityBucket {
  priority: string
  count: number
}

export interface CareGapHospitalBreakdown {
  hospital: string
  hospital_name: string | null
  hedis_measure: string
  open_count: number
}

export interface PopulationCareGapMetricsFilters {
  hospital: string | null
  profile_type: string | null
  provider_id: string | null
}

export interface PopulationCareGapMetricsResponse {
  total_patients: number
  by_measure: CareGapMeasureMetric[]
  by_priority: CareGapPriorityBucket[]
  by_hospital: CareGapHospitalBreakdown[]
  aggregation_ms: number
  pipeline_display: string
  filters: PopulationCareGapMetricsFilters
}

export async function fetchPopulationCareGapMetrics(params?: {
  hospital?: string | null
  profile_type?: string | null
  provider_id?: string | null
}): Promise<PopulationCareGapMetricsResponse> {
  const qs = new URLSearchParams()
  if (params?.hospital) qs.set("hospital", params.hospital)
  if (params?.profile_type) qs.set("profile_type", params.profile_type)
  if (params?.provider_id) qs.set("provider_id", params.provider_id)
  const suffix = qs.size ? `?${qs}` : ""
  return apiFetch<PopulationCareGapMetricsResponse>(
    `/dashboard/population/care-gap-metrics${suffix}`,
  )
}

// ---------------------------------------------------------------------------
// KED Intervention Workflow
// ---------------------------------------------------------------------------

export interface KedWorkflowResponse {
  patient_id: string
  ked_gap_exists: boolean
  ked_gap_open: boolean
  workflow_status: "not_started" | "ordered" | "completed"
  missing_evidence: string[]
  latest_kidney_labs: Record<string, unknown>[]
  follow_up_recommended: boolean
  follow_up_reason: string | null
  follow_up_summary: FollowUpSummaryResponse | null
}

export interface OrderKedLabsResponse {
  patient_id: string
  workflow_status: string
  ordered_at: string
  required_evidence: string[]
}

export interface RecordKedResultsPayload {
  result_profile: "stable" | "abnormal" | "concerning"
  recorded_by?: string
}

export interface RecordKedResultsResponse {
  patient_id: string
  workflow_status: string
  ked_gap_status: string
  follow_up_recommended: boolean
  follow_up_reason: string | null
  labs_written: Record<string, unknown>[]
}

export interface FollowUpSummaryResponse {
  title: string
  summary: string
  recommendations: string[]
  based_on: Record<string, unknown>
}

export async function fetchKedWorkflow(
  patientId: string,
): Promise<KedWorkflowResponse> {
  return apiFetch<KedWorkflowResponse>(`/interventions/ked/${patientId}`)
}

export async function orderKedLabs(
  patientId: string,
  orderedBy: string = "demo_user",
): Promise<OrderKedLabsResponse> {
  return apiFetch<OrderKedLabsResponse>(
    `/interventions/ked/${patientId}/order`,
    { method: "POST", body: JSON.stringify({ ordered_by: orderedBy }) },
  )
}

export async function recordKedResults(
  patientId: string,
  payload: RecordKedResultsPayload,
): Promise<RecordKedResultsResponse> {
  return apiFetch<RecordKedResultsResponse>(
    `/interventions/ked/${patientId}/results`,
    { method: "POST", body: JSON.stringify(payload) },
  )
}

export async function generateKedFollowUpSummary(
  patientId: string,
  requestedBy: string = "demo_user",
): Promise<FollowUpSummaryResponse> {
  return apiFetch<FollowUpSummaryResponse>(
    `/interventions/ked/${patientId}/follow-up-summary`,
    { method: "POST", body: JSON.stringify({ requested_by: requestedBy }) },
  )
}

// ---------------------------------------------------------------------------
// CDC-HBA Intervention Workflow
// ---------------------------------------------------------------------------

export interface CdcHbaWorkflowResponse {
  patient_id: string
  cdc_hba_gap_exists: boolean
  cdc_hba_gap_open: boolean
  workflow_status: "not_started" | "ordered" | "completed"
  missing_evidence: string[]
  latest_hba1c_lab: Record<string, unknown> | null
  follow_up_recommended: boolean
  follow_up_reason: string | null
  follow_up_summary: FollowUpSummaryResponse | null
}

export interface OrderCdcHbaTestResponse {
  patient_id: string
  workflow_status: string
  ordered_at: string
  required_evidence: string[]
}

export interface RecordCdcHbaResultsPayload {
  result_profile: "controlled" | "elevated" | "concerning"
  recorded_by?: string
}

export interface RecordCdcHbaResultsResponse {
  patient_id: string
  workflow_status: string
  cdc_hba_gap_status: string
  follow_up_recommended: boolean
  follow_up_reason: string | null
  lab_written: Record<string, unknown> | null
}

export async function fetchCdcHbaWorkflow(
  patientId: string,
): Promise<CdcHbaWorkflowResponse> {
  return apiFetch<CdcHbaWorkflowResponse>(`/interventions/cdc-hba/${patientId}`)
}

export async function orderCdcHbaTest(
  patientId: string,
  orderedBy: string = "demo_user",
): Promise<OrderCdcHbaTestResponse> {
  return apiFetch<OrderCdcHbaTestResponse>(
    `/interventions/cdc-hba/${patientId}/order`,
    { method: "POST", body: JSON.stringify({ ordered_by: orderedBy }) },
  )
}

export async function recordCdcHbaResults(
  patientId: string,
  payload: RecordCdcHbaResultsPayload,
): Promise<RecordCdcHbaResultsResponse> {
  return apiFetch<RecordCdcHbaResultsResponse>(
    `/interventions/cdc-hba/${patientId}/results`,
    { method: "POST", body: JSON.stringify(payload) },
  )
}

export async function generateCdcHbaFollowUpSummary(
  patientId: string,
  requestedBy: string = "demo_user",
): Promise<FollowUpSummaryResponse> {
  return apiFetch<FollowUpSummaryResponse>(
    `/interventions/cdc-hba/${patientId}/follow-up-summary`,
    { method: "POST", body: JSON.stringify({ requested_by: requestedBy }) },
  )
}

// ---------------------------------------------------------------------------
// CDS Hooks
// ---------------------------------------------------------------------------

export type CDSVitalTrigger = {
  vital: string
  value: number
  threshold: number
  direction: "above" | "below"
  unit: string
  source_rule?: string | null
}

export type CDSCardExtensions = {
  card_type: "alert" | "care_gap"
  measure_code?: string
  rule_id?: string
  rule_name?: string
  days_overdue?: number
  priority?: string
  context_factors?: string[]
  vital_triggers?: CDSVitalTrigger[]
  escalation_reason?: string
  ranking_weight?: number
}

export type CDSSuggestion = { label: string; uuid: string }

export type CDSCard = {
  uuid: string
  summary: string
  detail: string
  indicator: "info" | "warning" | "critical"
  source: { label: string; url?: string }
  suggestions: CDSSuggestion[]
  links: { label: string; url: string; type: string }[]
  extensions?: CDSCardExtensions
}

export type CDSHooksResponse = { cards: CDSCard[] }

export type CDSProvenanceResponse = {
  card: CDSCard
  source_rule: Record<string, unknown> | null
  care_gap_document: Record<string, unknown> | null
  alert_document: Record<string, unknown> | null
  patient_context: Record<string, unknown>
  generated_at: string
  data_source: string
}

export async function fetchCDSCards(patientId: string): Promise<CDSHooksResponse> {
  return apiFetch<CDSHooksResponse>("/hooks/cds-services/patient-view", {
    method: "POST",
    body: JSON.stringify({
      hookInstance: crypto.randomUUID(),
      hook: "patient-view",
      context: { patientId, userId: "Practitioner/care-coordinator" },
    }),
  })
}

export async function fetchCDSProvenance(
  patientId: string,
  cardUuid: string,
): Promise<CDSProvenanceResponse> {
  return apiFetch<CDSProvenanceResponse>(
    `/hooks/cds-provenance/${patientId}/${cardUuid}`,
  )
}

// ---------------------------------------------------------------------------
// Simulation worker
// ---------------------------------------------------------------------------

export async function startSimulation(params?: {
  interval_seconds?: number
}): Promise<{ status: string; patient_count?: number }> {
  return apiFetch("/simulation/start", {
    method: "POST",
    body: JSON.stringify(params ?? {}),
  })
}

export async function stopSimulation(): Promise<{ status: string }> {
  return apiFetch("/simulation/stop", { method: "POST" })
}

export interface SimulationStatus {
  running: boolean
  tick_count: number
  patient_count: number
  interval_seconds: number
  elapsed_seconds: number
  auto_stop_seconds: number
}

export async function getSimulationStatus(): Promise<SimulationStatus> {
  return apiFetch("/simulation/status")
}

export async function setSimulationPattern(
  patientIds: string[],
  pattern: string,
): Promise<{ modified: number; pattern: string }> {
  return apiFetch("/materializer/patients/simulation-pattern", {
    method: "POST",
    body: JSON.stringify({ patient_ids: patientIds, pattern }),
  })
}

// ---------------------------------------------------------------------------
// Queryable Encryption
// ---------------------------------------------------------------------------

export interface EncryptedFieldInfo {
  path: string
  queryable: boolean
  query_type: string | null
}

export interface HipaaMapping {
  field: string
  regulation: string
  category: string
}

export interface EncryptionStatusResponse {
  qe_enabled: boolean
  kms_provider: string
  encrypted_collection: string
  encrypted_fields: EncryptedFieldInfo[]
  hipaa_mapping: HipaaMapping[]
}

export interface ServerViewResponse {
  raw_document: Record<string, unknown>
  encrypted_field_paths: string[]
}

export async function fetchEncryptionStatus(): Promise<EncryptionStatusResponse> {
  return apiFetch("/encryption/status")
}

export async function fetchEncryptionServerView(
  patientId: string,
): Promise<ServerViewResponse> {
  return apiFetch(`/encryption/server-view/${patientId}`)
}
