// Mock data based on the Patient 360 schema from the project blueprint

export interface Patient360 {
  patient_id: string
  mrn: string
  source_hospital: "st_marys" | "regional_general" | "community_health"
  hospital_name: string
  profile_type: "target" | "healthy" | "diabetic" | "cardiac"
  demographics: {
    name: string
    given: string
    family: string
    gender: "male" | "female"
    birth_date: string
    age: number
  }
  conditions: Condition[]
  medications: Medication[]
  allergies: Allergy[]
  labs: LabResult[]
  flags: {
    has_beta_blocker: boolean
    has_insulin: boolean
    has_ace_inhibitor: boolean
    has_ckd: boolean
    condition_codes: string[]
  }
  personalized_thresholds: {
    heart_rate: { low: number; high: number; source_rule: string | null }
    respiratory_rate: { low: number; high: number; source_rule: string | null }
    temperature: { low: number; high: number; source_rule: string | null }
    spo2: { low: number; high: number; source_rule: string | null }
    activity_level: { low: number | null; high: number | null; source_rule: string | null }
  }
  vitals_summary: {
    latest: VitalReading
    avg_4h: Omit<VitalReading, "timestamp">
    trend_24h: {
      heart_rate: "stable" | "increasing" | "decreasing"
      respiratory_rate: "stable" | "increasing" | "decreasing"
      temperature: "stable" | "increasing" | "decreasing"
      spo2: "stable" | "increasing" | "decreasing"
      activity_level: "stable" | "increasing" | "decreasing"
    }
    refreshed_at: string
  }
  active_alerts: Alert[]
  care_gaps: CareGap[]
  encounters: Encounter[]
  created_at: string
  updated_at: string
}

export interface Condition {
  code: string
  system: string
  icd10: string
  display: string
  clinical_status: "active" | "resolved" | "inactive"
  onset_date: string
}

export interface Medication {
  code: string
  system: string
  display: string
  dose: string
  route: string
  frequency: string
  status: "active" | "stopped"
}

export interface Allergy {
  code: string
  display: string
  reaction: string
  severity: "mild" | "moderate" | "severe"
  criticality: "low" | "high"
}

export interface LabResult {
  loinc: string
  display: string
  value: number
  unit: string
  ref_low: number
  ref_high: number
  interpretation: "N" | "L" | "H" | "LL" | "HH"
  effective_date: string
}

export interface VitalReading {
  timestamp: string
  heart_rate: number
  respiratory_rate: number
  temperature: number
  spo2: number
  activity_level: number
}

export interface Alert {
  alert_id: string
  rule_id: string
  title: string
  severity: "critical" | "high" | "moderate" | "medium" | "low"
  alert_type: "threshold_breach" | "trend_alert" | "care_gap" | "multi_factor" | "comparative"
  reasoning: string
  suggested_actions: string[]
  created_at: string
  status: "new" | "acknowledged" | "resolved"
}

export interface CareGap {
  hedis_measure: string
  measure_name: string
  status: "open" | "closed"
  last_completed: string | null
  due_by: string
  days_overdue: number
  priority: "critical" | "high" | "medium" | "low"
  workflow_status?: "not_started" | "ordered" | "completed" | "reviewed"
  closure_evidence?: {
    required: string[]
    received: string[]
    missing: string[]
    closed_at: string | null
  }
  follow_up?: {
    recommended: boolean
    reason: string | null
    status: "not_needed" | "pending_review" | "reviewed"
  }
}

export interface Encounter {
  status: "planned" | "arrived" | "in-progress" | "finished" | "cancelled"
  class: "inpatient" | "outpatient" | "emergency"
  period_start: string
  period_end: string | null
  provider: string
}

// Time series vitals for charts
export interface VitalsTimeSeries {
  timestamp: string
  heart_rate: number
  respiratory_rate: number
  temperature: number
  spo2: number
  activity_level: number
  event?: "hypoglycemia" | "sepsis" | null
}

// Generate mock vitals time series
function generateVitalsTimeSeries(
  hours: number,
  baselineHR: number,
  baselineSpo2: number,
  includeEvent?: "hypoglycemia" | "sepsis"
): VitalsTimeSeries[] {
  const now = new Date()
  const data: VitalsTimeSeries[] = []
  const pointsPerHour = 12 // 5-minute intervals

  for (let i = hours * pointsPerHour; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 5 * 60 * 1000)
    const hourOffset = i / pointsPerHour
    
    // Add some natural variation
    const variation = Math.sin(hourOffset * 0.5) * 3
    
    let hr = baselineHR + variation + (Math.random() - 0.5) * 4
    let spo2 = baselineSpo2 + (Math.random() - 0.5) * 1.5
    let rr = 16 + (Math.random() - 0.5) * 2
    let temp = 37.0 + (Math.random() - 0.5) * 0.3
    let activity = 3 + (Math.random() - 0.5) * 2
    let event: "hypoglycemia" | "sepsis" | null = null

    // Simulate event patterns
    if (includeEvent === "hypoglycemia" && hourOffset < 2 && hourOffset > 0.5) {
      hr += 25
      activity = 0.5
      temp -= 0.3
      event = "hypoglycemia"
    } else if (includeEvent === "sepsis" && hourOffset < 4) {
      const sepsisFactor = (4 - hourOffset) / 4
      hr += sepsisFactor * 15
      temp += sepsisFactor * 1.2
      rr += sepsisFactor * 6
      spo2 -= sepsisFactor * 4
      event = "sepsis"
    }

    data.push({
      timestamp: timestamp.toISOString(),
      heart_rate: Math.round(hr * 10) / 10,
      respiratory_rate: Math.round(rr * 10) / 10,
      temperature: Math.round(temp * 100) / 100,
      spo2: Math.min(100, Math.round(spo2 * 10) / 10),
      activity_level: Math.max(0, Math.round(activity * 10) / 10),
      event,
    })
  }

  return data
}

// Mock patients based on the demo scenario
export const mockPatients: Patient360[] = [
  {
    patient_id: "pt-001-maria-garcia",
    mrn: "MRN782341",
    source_hospital: "st_marys",
    hospital_name: "St. Mary's Medical Center",
    profile_type: "target",
    demographics: {
      name: "Maria Garcia",
      given: "Maria",
      family: "Garcia",
      gender: "female",
      birth_date: "1952-04-15",
      age: 73,
    },
    conditions: [
      { code: "44054006", system: "http://snomed.info/sct", icd10: "E11.9", display: "Type 2 diabetes mellitus", clinical_status: "active", onset_date: "2018-06-12" },
      { code: "433144002", system: "http://snomed.info/sct", icd10: "N18.3", display: "Chronic kidney disease stage 3", clinical_status: "active", onset_date: "2020-01-15" },
      { code: "59621000", system: "http://snomed.info/sct", icd10: "I10", display: "Essential hypertension", clinical_status: "active", onset_date: "2015-03-22" },
      { code: "230572002", system: "http://snomed.info/sct", icd10: "G63", display: "Peripheral neuropathy", clinical_status: "active", onset_date: "2021-08-10" },
    ],
    medications: [
      { code: "197381", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Atenolol 50 mg oral tablet", dose: "50 mg", route: "oral", frequency: "once daily", status: "active" },
      { code: "311040", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Insulin Glargine 100 units/mL", dose: "20 units", route: "subcutaneous", frequency: "once daily at bedtime", status: "active" },
      { code: "860975", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Metformin 500 mg oral tablet", dose: "500 mg", route: "oral", frequency: "twice daily", status: "active" },
      { code: "314076", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Lisinopril 10 mg oral tablet", dose: "10 mg", route: "oral", frequency: "once daily", status: "active" },
    ],
    allergies: [
      { code: "7980", display: "Penicillin", reaction: "Anaphylaxis", severity: "severe", criticality: "high" },
    ],
    labs: [
      { loinc: "4548-4", display: "Hemoglobin A1c", value: 8.2, unit: "%", ref_low: 4.0, ref_high: 5.6, interpretation: "H", effective_date: "2026-03-01" },
      { loinc: "2160-0", display: "Creatinine", value: 1.8, unit: "mg/dL", ref_low: 0.6, ref_high: 1.2, interpretation: "H", effective_date: "2026-03-15" },
      { loinc: "62238-1", display: "eGFR", value: 42, unit: "mL/min/1.73m2", ref_low: 90, ref_high: 120, interpretation: "L", effective_date: "2026-03-15" },
      { loinc: "2823-3", display: "Potassium", value: 5.1, unit: "mEq/L", ref_low: 3.5, ref_high: 5.0, interpretation: "H", effective_date: "2026-03-15" },
    ],
    flags: {
      has_beta_blocker: true,
      has_insulin: true,
      has_ace_inhibitor: true,
      has_ckd: true,
      condition_codes: ["44054006", "433144002", "59621000", "230572002"],
    },
    personalized_thresholds: {
      heart_rate: { low: 50, high: 90, source_rule: "cds_beta_blocker_hr" },
      respiratory_rate: { low: 10, high: 22, source_rule: "cds_ckd_respiratory" },
      temperature: { low: 36.0, high: 38.0, source_rule: null },
      spo2: { low: 92, high: 100, source_rule: "cds_ckd_spo2" },
      activity_level: { low: null, high: null, source_rule: null },
    },
    vitals_summary: {
      latest: { timestamp: "2026-03-25T14:30:00Z", heart_rate: 95.2, respiratory_rate: 19.1, temperature: 37.4, spo2: 93.8, activity_level: 1.2 },
      avg_4h: { heart_rate: 88.5, respiratory_rate: 18.2, temperature: 37.2, spo2: 94.1, activity_level: 2.1 },
      trend_24h: { heart_rate: "increasing", respiratory_rate: "increasing", temperature: "stable", spo2: "decreasing", activity_level: "decreasing" },
      refreshed_at: "2026-03-25T14:30:00Z",
    },
    active_alerts: [
      {
        alert_id: "alert-001",
        rule_id: "cds_beta_blocker_hr",
        title: "Elevated HR on Beta-Blocker Therapy",
        severity: "high",
        alert_type: "threshold_breach",
        reasoning: "Patient is on Atenolol 50 mg. Expected resting HR: 55-75 bpm. Current HR of 95.2 bpm is significantly elevated despite beta-blockade, suggesting possible infection, hypoglycemia, or medication non-compliance.",
        suggested_actions: ["Check blood glucose", "Assess for signs of infection", "Verify medication compliance", "Consider 12-lead ECG"],
        created_at: "2026-03-25T14:32:00Z",
        status: "new",
      },
      {
        alert_id: "alert-002",
        rule_id: "cds_ckd_respiratory",
        title: "Elevated Respiratory Rate - CKD Patient",
        severity: "medium",
        alert_type: "trend_alert",
        reasoning: "Respiratory rate trending upward over 24h in patient with CKD Stage 3. May indicate early metabolic acidosis or fluid overload.",
        suggested_actions: ["Order basic metabolic panel", "Check for signs of fluid overload", "Review recent dialysis schedule"],
        created_at: "2026-03-25T12:15:00Z",
        status: "acknowledged",
      },
    ],
    care_gaps: [
      { hedis_measure: "CDC-HBA", measure_name: "Comprehensive Diabetes Care - HbA1c Testing", status: "open", last_completed: "2025-09-15", due_by: "2026-03-15", days_overdue: 10, priority: "high" },
      { hedis_measure: "KED", measure_name: "Kidney Evaluation for Diabetic Patients", status: "open", last_completed: "2025-08-01", due_by: "2026-02-01", days_overdue: 52, priority: "critical" },
      { hedis_measure: "EED", measure_name: "Annual Eye Exam for Diabetics", status: "open", last_completed: "2025-01-20", due_by: "2026-01-20", days_overdue: 64, priority: "high" },
    ],
    encounters: [
      { status: "finished", class: "inpatient", period_start: "2026-02-10", period_end: "2026-02-13", provider: "St. Mary's Medical Center" },
      { status: "finished", class: "outpatient", period_start: "2026-03-01", period_end: "2026-03-01", provider: "St. Mary's Medical Center" },
    ],
    created_at: "2026-01-15T10:00:00Z",
    updated_at: "2026-03-25T14:30:00Z",
  },
  {
    patient_id: "pt-002-james-wilson",
    mrn: "MRN891234",
    source_hospital: "st_marys",
    hospital_name: "St. Mary's Medical Center",
    profile_type: "healthy",
    demographics: {
      name: "James Wilson",
      given: "James",
      family: "Wilson",
      gender: "male",
      birth_date: "1992-08-22",
      age: 33,
    },
    conditions: [],
    medications: [],
    allergies: [],
    labs: [
      { loinc: "718-7", display: "Hemoglobin", value: 15.2, unit: "g/dL", ref_low: 13.5, ref_high: 17.5, interpretation: "N", effective_date: "2026-03-10" },
    ],
    flags: {
      has_beta_blocker: false,
      has_insulin: false,
      has_ace_inhibitor: false,
      has_ckd: false,
      condition_codes: [],
    },
    personalized_thresholds: {
      heart_rate: { low: 50, high: 100, source_rule: null },
      respiratory_rate: { low: 10, high: 20, source_rule: null },
      temperature: { low: 36.0, high: 38.0, source_rule: null },
      spo2: { low: 95, high: 100, source_rule: null },
      activity_level: { low: null, high: null, source_rule: null },
    },
    vitals_summary: {
      latest: { timestamp: "2026-03-25T14:25:00Z", heart_rate: 95.0, respiratory_rate: 18.8, temperature: 37.3, spo2: 93.5, activity_level: 1.5 },
      avg_4h: { heart_rate: 92.1, respiratory_rate: 17.9, temperature: 37.2, spo2: 94.0, activity_level: 2.0 },
      trend_24h: { heart_rate: "stable", respiratory_rate: "stable", temperature: "stable", spo2: "stable", activity_level: "stable" },
      refreshed_at: "2026-03-25T14:25:00Z",
    },
    active_alerts: [],
    care_gaps: [],
    encounters: [
      { status: "finished", class: "outpatient", period_start: "2026-03-10", period_end: "2026-03-10", provider: "St. Mary's Medical Center" },
    ],
    created_at: "2026-03-01T09:00:00Z",
    updated_at: "2026-03-25T14:25:00Z",
  },
  {
    patient_id: "pt-003-robert-johnson",
    mrn: "MRN456789",
    source_hospital: "regional_general",
    hospital_name: "Regional General Hospital",
    profile_type: "target",
    demographics: {
      name: "Robert Johnson",
      given: "Robert",
      family: "Johnson",
      gender: "male",
      birth_date: "1948-11-03",
      age: 77,
    },
    conditions: [
      { code: "44054006", system: "http://snomed.info/sct", icd10: "E11.65", display: "Type 2 diabetes mellitus with hyperglycemia", clinical_status: "active", onset_date: "2010-04-20" },
      { code: "433144002", system: "http://snomed.info/sct", icd10: "N18.3", display: "Chronic kidney disease stage 3", clinical_status: "active", onset_date: "2019-07-12" },
      { code: "42343007", system: "http://snomed.info/sct", icd10: "I50.9", display: "Congestive heart failure", clinical_status: "active", onset_date: "2022-02-28" },
      { code: "59621000", system: "http://snomed.info/sct", icd10: "I10", display: "Essential hypertension", clinical_status: "active", onset_date: "2008-06-15" },
    ],
    medications: [
      { code: "197381", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Metoprolol 25 mg oral tablet", dose: "25 mg", route: "oral", frequency: "twice daily", status: "active" },
      { code: "311040", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Insulin Glargine 100 units/mL", dose: "30 units", route: "subcutaneous", frequency: "once daily at bedtime", status: "active" },
      { code: "200801", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Furosemide 40 mg oral tablet", dose: "40 mg", route: "oral", frequency: "once daily", status: "active" },
    ],
    allergies: [
      { code: "1191", display: "Aspirin", reaction: "Gastrointestinal bleeding", severity: "moderate", criticality: "high" },
      { code: "4337", display: "Codeine", reaction: "Nausea and vomiting", severity: "mild", criticality: "low" },
    ],
    labs: [
      { loinc: "4548-4", display: "Hemoglobin A1c", value: 9.1, unit: "%", ref_low: 4.0, ref_high: 5.6, interpretation: "HH", effective_date: "2026-02-20" },
      { loinc: "2160-0", display: "Creatinine", value: 2.1, unit: "mg/dL", ref_low: 0.6, ref_high: 1.2, interpretation: "HH", effective_date: "2026-03-18" },
      { loinc: "62238-1", display: "eGFR", value: 35, unit: "mL/min/1.73m2", ref_low: 90, ref_high: 120, interpretation: "LL", effective_date: "2026-03-18" },
      { loinc: "33762-6", display: "BNP", value: 450, unit: "pg/mL", ref_low: 0, ref_high: 100, interpretation: "HH", effective_date: "2026-03-18" },
    ],
    flags: {
      has_beta_blocker: true,
      has_insulin: true,
      has_ace_inhibitor: false,
      has_ckd: true,
      condition_codes: ["44054006", "433144002", "42343007", "59621000"],
    },
    personalized_thresholds: {
      heart_rate: { low: 50, high: 85, source_rule: "cds_beta_blocker_hr" },
      respiratory_rate: { low: 10, high: 20, source_rule: "cds_chf_respiratory" },
      temperature: { low: 36.0, high: 38.0, source_rule: null },
      spo2: { low: 90, high: 100, source_rule: "cds_chf_spo2" },
      activity_level: { low: null, high: null, source_rule: null },
    },
    vitals_summary: {
      latest: { timestamp: "2026-03-25T14:28:00Z", heart_rate: 78.5, respiratory_rate: 22.3, temperature: 37.8, spo2: 91.2, activity_level: 0.8 },
      avg_4h: { heart_rate: 76.2, respiratory_rate: 21.1, temperature: 37.6, spo2: 91.8, activity_level: 1.2 },
      trend_24h: { heart_rate: "stable", respiratory_rate: "increasing", temperature: "increasing", spo2: "decreasing", activity_level: "decreasing" },
      refreshed_at: "2026-03-25T14:28:00Z",
    },
    active_alerts: [
      {
        alert_id: "alert-003",
        rule_id: "cds_sepsis_warning",
        title: "Sepsis Risk - Early Warning",
        severity: "critical",
        alert_type: "threshold_breach",
        reasoning: "Patient meets 3 modified SIRS criteria: Temp 37.8C (elevated), RR 22.3 (>20), HR 78.5 with declining SpO2 to 91.2%. Combined with diabetes, CKD, and recent hospitalization, sepsis risk is elevated.",
        suggested_actions: ["Obtain blood cultures x2", "Order lactate level stat", "Review for source of infection", "Consider broad-spectrum antibiotics", "Notify attending physician"],
        created_at: "2026-03-25T14:30:00Z",
        status: "new",
      },
      {
        alert_id: "alert-004",
        rule_id: "cds_chf_decompensation",
        title: "CHF Decompensation Risk",
        severity: "high",
        alert_type: "trend_alert",
        reasoning: "Declining SpO2 trend over 24h with elevated respiratory rate in patient with known CHF. BNP 450 pg/mL. May indicate fluid overload.",
        suggested_actions: ["Auscultate lung fields", "Check for peripheral edema", "Review fluid intake/output", "Consider additional diuretic dose"],
        created_at: "2026-03-25T10:45:00Z",
        status: "acknowledged",
      },
    ],
    care_gaps: [
      { hedis_measure: "CDC-HBA", measure_name: "Comprehensive Diabetes Care - HbA1c Testing", status: "open", last_completed: "2026-02-20", due_by: "2026-08-20", days_overdue: 0, priority: "medium" },
      { hedis_measure: "SPD", measure_name: "Statin Therapy for Diabetic Patients", status: "open", last_completed: null, due_by: "2026-01-01", days_overdue: 83, priority: "high" },
    ],
    encounters: [
      { status: "finished", class: "emergency", period_start: "2026-03-05", period_end: "2026-03-08", provider: "Regional General Hospital" },
    ],
    created_at: "2026-01-05T08:30:00Z",
    updated_at: "2026-03-25T14:28:00Z",
  },
  {
    patient_id: "pt-004-helen-chen",
    mrn: "MRN234567",
    source_hospital: "community_health",
    hospital_name: "Community Health Partners",
    profile_type: "diabetic",
    demographics: {
      name: "Helen Chen",
      given: "Helen",
      family: "Chen",
      gender: "female",
      birth_date: "1960-02-28",
      age: 66,
    },
    conditions: [
      { code: "44054006", system: "http://snomed.info/sct", icd10: "E11.9", display: "Type 2 diabetes mellitus", clinical_status: "active", onset_date: "2015-09-10" },
      { code: "59621000", system: "http://snomed.info/sct", icd10: "I10", display: "Essential hypertension", clinical_status: "active", onset_date: "2012-04-18" },
    ],
    medications: [
      { code: "860975", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Metformin 1000 mg oral tablet", dose: "1000 mg", route: "oral", frequency: "twice daily", status: "active" },
      { code: "311040", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Insulin Lispro 100 units/mL", dose: "varies", route: "subcutaneous", frequency: "before meals", status: "active" },
      { code: "314076", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Lisinopril 20 mg oral tablet", dose: "20 mg", route: "oral", frequency: "once daily", status: "active" },
    ],
    allergies: [],
    labs: [
      { loinc: "4548-4", display: "Hemoglobin A1c", value: 7.4, unit: "%", ref_low: 4.0, ref_high: 5.6, interpretation: "H", effective_date: "2026-03-12" },
      { loinc: "2160-0", display: "Creatinine", value: 0.9, unit: "mg/dL", ref_low: 0.6, ref_high: 1.2, interpretation: "N", effective_date: "2026-03-12" },
    ],
    flags: {
      has_beta_blocker: false,
      has_insulin: true,
      has_ace_inhibitor: true,
      has_ckd: false,
      condition_codes: ["44054006", "59621000"],
    },
    personalized_thresholds: {
      heart_rate: { low: 50, high: 100, source_rule: null },
      respiratory_rate: { low: 10, high: 20, source_rule: null },
      temperature: { low: 36.0, high: 38.0, source_rule: null },
      spo2: { low: 95, high: 100, source_rule: null },
      activity_level: { low: null, high: null, source_rule: null },
    },
    vitals_summary: {
      latest: { timestamp: "2026-03-25T14:20:00Z", heart_rate: 72.1, respiratory_rate: 14.8, temperature: 36.8, spo2: 97.5, activity_level: 4.2 },
      avg_4h: { heart_rate: 71.5, respiratory_rate: 14.5, temperature: 36.7, spo2: 97.8, activity_level: 4.5 },
      trend_24h: { heart_rate: "stable", respiratory_rate: "stable", temperature: "stable", spo2: "stable", activity_level: "stable" },
      refreshed_at: "2026-03-25T14:20:00Z",
    },
    active_alerts: [],
    care_gaps: [
      { hedis_measure: "EED", measure_name: "Annual Eye Exam for Diabetics", status: "open", last_completed: "2025-02-15", due_by: "2026-02-15", days_overdue: 38, priority: "medium" },
    ],
    encounters: [
      { status: "finished", class: "outpatient", period_start: "2026-03-12", period_end: "2026-03-12", provider: "Community Health Partners" },
    ],
    created_at: "2025-06-20T11:00:00Z",
    updated_at: "2026-03-25T14:20:00Z",
  },
  {
    patient_id: "pt-005-william-brown",
    mrn: "MRN567890",
    source_hospital: "regional_general",
    hospital_name: "Regional General Hospital",
    profile_type: "cardiac",
    demographics: {
      name: "William Brown",
      given: "William",
      family: "Brown",
      gender: "male",
      birth_date: "1955-07-14",
      age: 70,
    },
    conditions: [
      { code: "42343007", system: "http://snomed.info/sct", icd10: "I50.9", display: "Congestive heart failure", clinical_status: "active", onset_date: "2020-11-22" },
      { code: "49436004", system: "http://snomed.info/sct", icd10: "I48.91", display: "Atrial fibrillation", clinical_status: "active", onset_date: "2021-03-15" },
      { code: "13645005", system: "http://snomed.info/sct", icd10: "J44.9", display: "Chronic obstructive pulmonary disease", clinical_status: "active", onset_date: "2018-05-10" },
    ],
    medications: [
      { code: "197381", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Carvedilol 12.5 mg oral tablet", dose: "12.5 mg", route: "oral", frequency: "twice daily", status: "active" },
      { code: "855332", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Warfarin 5 mg oral tablet", dose: "5 mg", route: "oral", frequency: "once daily", status: "active" },
      { code: "200801", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Furosemide 20 mg oral tablet", dose: "20 mg", route: "oral", frequency: "once daily", status: "active" },
    ],
    allergies: [
      { code: "7982", display: "Sulfa drugs", reaction: "Rash", severity: "moderate", criticality: "low" },
    ],
    labs: [
      { loinc: "33762-6", display: "BNP", value: 280, unit: "pg/mL", ref_low: 0, ref_high: 100, interpretation: "H", effective_date: "2026-03-20" },
      { loinc: "6301-6", display: "INR", value: 2.4, unit: "", ref_low: 2.0, ref_high: 3.0, interpretation: "N", effective_date: "2026-03-22" },
    ],
    flags: {
      has_beta_blocker: true,
      has_insulin: false,
      has_ace_inhibitor: false,
      has_ckd: false,
      condition_codes: ["42343007", "49436004", "13645005"],
    },
    personalized_thresholds: {
      heart_rate: { low: 50, high: 90, source_rule: "cds_beta_blocker_hr" },
      respiratory_rate: { low: 10, high: 22, source_rule: "cds_copd_respiratory" },
      temperature: { low: 36.0, high: 38.0, source_rule: null },
      spo2: { low: 88, high: 100, source_rule: "cds_copd_spo2" },
      activity_level: { low: null, high: null, source_rule: null },
    },
    vitals_summary: {
      latest: { timestamp: "2026-03-25T14:15:00Z", heart_rate: 68.4, respiratory_rate: 18.2, temperature: 36.9, spo2: 92.1, activity_level: 2.1 },
      avg_4h: { heart_rate: 67.8, respiratory_rate: 17.8, temperature: 36.8, spo2: 92.5, activity_level: 2.5 },
      trend_24h: { heart_rate: "stable", respiratory_rate: "stable", temperature: "stable", spo2: "stable", activity_level: "stable" },
      refreshed_at: "2026-03-25T14:15:00Z",
    },
    active_alerts: [],
    care_gaps: [],
    encounters: [
      { status: "finished", class: "outpatient", period_start: "2026-03-20", period_end: "2026-03-20", provider: "Regional General Hospital" },
    ],
    created_at: "2025-11-10T09:15:00Z",
    updated_at: "2026-03-25T14:15:00Z",
  },
  {
    patient_id: "pt-006-dorothy-martinez",
    mrn: "MRN678901",
    source_hospital: "st_marys",
    hospital_name: "St. Mary's Medical Center",
    profile_type: "target",
    demographics: {
      name: "Dorothy Martinez",
      given: "Dorothy",
      family: "Martinez",
      gender: "female",
      birth_date: "1945-12-08",
      age: 80,
    },
    conditions: [
      { code: "44054006", system: "http://snomed.info/sct", icd10: "E11.9", display: "Type 2 diabetes mellitus", clinical_status: "active", onset_date: "2005-03-15" },
      { code: "433144002", system: "http://snomed.info/sct", icd10: "N18.4", display: "Chronic kidney disease stage 4", clinical_status: "active", onset_date: "2023-06-20" },
      { code: "59621000", system: "http://snomed.info/sct", icd10: "I10", display: "Essential hypertension", clinical_status: "active", onset_date: "2000-08-22" },
      { code: "230572002", system: "http://snomed.info/sct", icd10: "G63", display: "Peripheral neuropathy", clinical_status: "active", onset_date: "2018-11-05" },
      { code: "42343007", system: "http://snomed.info/sct", icd10: "I50.9", display: "Congestive heart failure", clinical_status: "active", onset_date: "2024-01-10" },
    ],
    medications: [
      { code: "197381", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Atenolol 25 mg oral tablet", dose: "25 mg", route: "oral", frequency: "once daily", status: "active" },
      { code: "311040", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Insulin Glargine 100 units/mL", dose: "35 units", route: "subcutaneous", frequency: "once daily at bedtime", status: "active" },
      { code: "200801", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "Furosemide 80 mg oral tablet", dose: "80 mg", route: "oral", frequency: "twice daily", status: "active" },
    ],
    allergies: [
      { code: "2670", display: "Codeine", reaction: "Respiratory depression", severity: "severe", criticality: "high" },
      { code: "7980", display: "Penicillin", reaction: "Hives", severity: "moderate", criticality: "low" },
    ],
    labs: [
      { loinc: "4548-4", display: "Hemoglobin A1c", value: 8.8, unit: "%", ref_low: 4.0, ref_high: 5.6, interpretation: "HH", effective_date: "2026-02-28" },
      { loinc: "2160-0", display: "Creatinine", value: 2.8, unit: "mg/dL", ref_low: 0.6, ref_high: 1.2, interpretation: "HH", effective_date: "2026-03-20" },
      { loinc: "62238-1", display: "eGFR", value: 22, unit: "mL/min/1.73m2", ref_low: 90, ref_high: 120, interpretation: "LL", effective_date: "2026-03-20" },
      { loinc: "2823-3", display: "Potassium", value: 5.6, unit: "mEq/L", ref_low: 3.5, ref_high: 5.0, interpretation: "HH", effective_date: "2026-03-20" },
    ],
    flags: {
      has_beta_blocker: true,
      has_insulin: true,
      has_ace_inhibitor: false,
      has_ckd: true,
      condition_codes: ["44054006", "433144002", "59621000", "230572002", "42343007"],
    },
    personalized_thresholds: {
      heart_rate: { low: 50, high: 85, source_rule: "cds_beta_blocker_hr" },
      respiratory_rate: { low: 10, high: 20, source_rule: "cds_ckd_chf_respiratory" },
      temperature: { low: 36.0, high: 37.8, source_rule: null },
      spo2: { low: 90, high: 100, source_rule: "cds_ckd_chf_spo2" },
      activity_level: { low: null, high: null, source_rule: null },
    },
    vitals_summary: {
      latest: { timestamp: "2026-03-25T14:22:00Z", heart_rate: 62.3, respiratory_rate: 16.5, temperature: 36.7, spo2: 94.2, activity_level: 1.8 },
      avg_4h: { heart_rate: 61.8, respiratory_rate: 16.2, temperature: 36.6, spo2: 94.5, activity_level: 2.0 },
      trend_24h: { heart_rate: "stable", respiratory_rate: "stable", temperature: "stable", spo2: "stable", activity_level: "stable" },
      refreshed_at: "2026-03-25T14:22:00Z",
    },
    active_alerts: [
      {
        alert_id: "alert-005",
        rule_id: "cds_hyperkalemia",
        title: "Hyperkalemia Risk - CKD Stage 4",
        severity: "high",
        alert_type: "threshold_breach",
        reasoning: "Potassium 5.6 mEq/L in patient with CKD Stage 4 (eGFR 22). Risk of cardiac arrhythmia. Review potassium-sparing medications and dietary intake.",
        suggested_actions: ["Obtain stat EKG", "Review medication list for potassium-sparing agents", "Consider potassium-lowering therapy", "Dietary consultation"],
        created_at: "2026-03-25T11:00:00Z",
        status: "acknowledged",
      },
    ],
    care_gaps: [
      { hedis_measure: "CDC-HBA", measure_name: "Comprehensive Diabetes Care - HbA1c Testing", status: "open", last_completed: "2026-02-28", due_by: "2026-08-28", days_overdue: 0, priority: "medium" },
      { hedis_measure: "KED", measure_name: "Kidney Evaluation for Diabetic Patients", status: "open", last_completed: "2026-03-20", due_by: "2027-03-20", days_overdue: 0, priority: "low" },
    ],
    encounters: [
      { status: "in-progress", class: "inpatient", period_start: "2026-03-23", period_end: null, provider: "St. Mary's Medical Center" },
    ],
    created_at: "2024-08-15T14:30:00Z",
    updated_at: "2026-03-25T14:22:00Z",
  },
]

// Generate vitals time series for each patient
export const mockVitalsTimeSeries: Record<string, VitalsTimeSeries[]> = {
  "pt-001-maria-garcia": generateVitalsTimeSeries(24, 70, 95.5, "hypoglycemia"),
  "pt-002-james-wilson": generateVitalsTimeSeries(24, 75, 97),
  "pt-003-robert-johnson": generateVitalsTimeSeries(24, 72, 92, "sepsis"),
  "pt-004-helen-chen": generateVitalsTimeSeries(24, 72, 97.5),
  "pt-005-william-brown": generateVitalsTimeSeries(24, 68, 92),
  "pt-006-dorothy-martinez": generateVitalsTimeSeries(24, 62, 94),
}

// Summary stats for dashboard
export const dashboardStats = {
  totalPatients: mockPatients.length,
  criticalAlerts: mockPatients.reduce((sum, p) => sum + p.active_alerts.filter(a => a.severity === "critical").length, 0),
  highAlerts: mockPatients.reduce((sum, p) => sum + p.active_alerts.filter(a => a.severity === "high").length, 0),
  openCareGaps: mockPatients.reduce((sum, p) => sum + p.care_gaps.filter(g => g.status === "open").length, 0),
  overdueGaps: mockPatients.reduce((sum, p) => sum + p.care_gaps.filter(g => g.days_overdue > 0).length, 0),
  hospitalBreakdown: {
    st_marys: mockPatients.filter(p => p.source_hospital === "st_marys").length,
    regional_general: mockPatients.filter(p => p.source_hospital === "regional_general").length,
    community_health: mockPatients.filter(p => p.source_hospital === "community_health").length,
  },
}
