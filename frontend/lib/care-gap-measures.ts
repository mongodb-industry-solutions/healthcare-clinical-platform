import type { CareGap, CareGapResultEvaluationComponent } from "@/lib/mock-data"

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

/**
 * Care gap UI state, derived from the raw status + the optional result
 * evaluation. Centralized so every component reads the same precedence rule.
 *
 * - `open`               — screening overdue or never performed
 * - `closed_controlled`  — screening done and result at target
 * - `closed_uncontrolled` — screening done but result NOT at target ("Closed — flagged")
 * - `due_soon`           — DEQM "prospective"; screening done but closing
 *                          within `DUE_SOON_WINDOW_DAYS` (60 in the engine)
 *
 * Precedence: open > closed_uncontrolled > due_soon > closed_controlled.
 * Open takes precedence because nothing actionable beats an overdue gap.
 * `closed_uncontrolled` outranks `due_soon` because a failing prior result
 * is a more urgent signal than a normal-but-aging screening.
 */
export type EffectiveGapState =
  | "open"
  | "closed_controlled"
  | "closed_uncontrolled"
  | "due_soon"

export function getEffectiveGapState(gap: CareGap): EffectiveGapState {
  if (gap.status === "open") return "open"
  if (gap.result_evaluation && gap.result_evaluation.controlled === false) {
    return "closed_uncontrolled"
  }
  if (gap.status === "due_soon") return "due_soon"
  return "closed_controlled"
}

const COMPARATOR_LABEL: Record<CareGapResultEvaluationComponent["comparator"], string> = {
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
}

/** Render a single result-evaluation component as a one-line summary. */
export function formatGapResultComponent(
  component: CareGapResultEvaluationComponent,
): string {
  const unit = component.unit ?? ""
  const value = component.value !== null ? component.value : "—"
  const target = `${COMPARATOR_LABEL[component.comparator]} ${component.target}${unit ? ` ${unit}` : ""}`
  return `${component.label} ${value}${unit ? ` ${unit}` : ""} (target ${target})`
}
