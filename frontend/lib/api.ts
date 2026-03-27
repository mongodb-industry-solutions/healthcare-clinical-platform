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

export async function seedCdsRules(): Promise<{
  inserted: number
  rules: string[]
}> {
  return apiFetch("/cds/rules/seed", { method: "POST" })
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

export async function computeCareGaps(): Promise<{
  processed: number
  total_patients: number
  total_gaps_found: number
  errors: string[]
}> {
  return apiFetch("/cds/care-gaps", { method: "POST" })
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
