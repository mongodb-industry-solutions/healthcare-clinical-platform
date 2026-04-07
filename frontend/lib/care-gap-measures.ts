export type CareGapMeasureMeta = {
  name: string
  description: string
  dashboardLabel: string
  actionLabel: string
}

export const CARE_GAP_MEASURE_META: Record<string, CareGapMeasureMeta> = {
  "CDC-HBA": {
    name: "HbA1c Testing",
    description: "Comprehensive Diabetes Care — HbA1c every 6 months",
    dashboardLabel: "HbA1c follow-up",
    actionLabel: "Schedule or order an HbA1c follow-up",
  },
  KED: {
    name: "Kidney Evaluation",
    description: "Annual eGFR + uACR for diabetic patients",
    dashboardLabel: "Kidney evaluation",
    actionLabel: "Order kidney evaluation labs and route follow-up",
  },
  CBP: {
    name: "Blood Pressure Control",
    description: "BP target < 140/90 for diabetic patients",
    dashboardLabel: "BP control",
    actionLabel: "Schedule blood pressure follow-up and confirm control plan",
  },
  SPD: {
    name: "Statin Therapy",
    description: "Diabetic patients 40–75 should be on statin",
    dashboardLabel: "Statin therapy",
    actionLabel: "Review statin therapy gap and route medication follow-up",
  },
  EED: {
    name: "Eye Exam",
    description: "Annual retinal exam for diabetics",
    dashboardLabel: "Eye exam",
    actionLabel: "Schedule diabetic eye exam outreach",
  },
}

export function getCareGapMeasureMeta(measure: string) {
  return CARE_GAP_MEASURE_META[measure]
}

export function getCareGapMeasureDescription(measure: string, fallback?: string) {
  return CARE_GAP_MEASURE_META[measure]?.description ?? fallback ?? measure
}

export function getCareGapMeasureDashboardLabel(measure: string) {
  return CARE_GAP_MEASURE_META[measure]?.dashboardLabel ?? measure
}

export function getCareGapMeasureActionLabel(measure: string) {
  return CARE_GAP_MEASURE_META[measure]?.actionLabel ?? `Advance ${measure} gap closure workflow`
}
