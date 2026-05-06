"""
HEDIS Care Gap measure definitions for the demo.

5 measures targeting the Type 2 Diabetes + CKD cohort:
1. CDC-HBA  — Comprehensive Diabetes Care: HbA1c Testing
2. KED      — Kidney Health Evaluation for Patients with Diabetes
3. CBP      — Controlling High Blood Pressure (Diabetes subset)
4. SPD      — Statin Therapy for Patients with Diabetes
5. EED      — Eye Exam for Patients with Diabetes

Result evaluation
-----------------
Some measures expose an optional `result_evaluation` block. When present, the
quality engine performs a second-pass check after the screening-existence
check: HEDIS counts the screening as the numerator (status stays `closed`),
but if the actual result fails the clinical target the engine flags the gap
as "closed but not controlled" — drives the `Closed — flagged` UI state.

Schema:
    result_evaluation = {
        "components": [
            {
                "loinc": "4548-4",
                "label": "HbA1c",
                "comparator": "lt" | "lte" | "gt" | "gte",
                "target": float,
                "unit": str,
            },
            ...
        ],
        "control_label": str,                     # e.g. "controlled"
        "uncontrolled_label": str,                # e.g. "poorly controlled"
        "uncontrolled_action": str,               # replaces recommended_action
        "uncontrolled_priority_floor": str,       # priority bumps to at least this
    }
"""

HEDIS_MEASURES: list[dict] = [
    {
        "measure_code": "CDC-HBA",
        "measure_name": "Comprehensive Diabetes Care — HbA1c Testing",
        "description": "Diabetic patients should have HbA1c tested every 6 months.",
        "applicable_conditions": ["44054006"],  # T2DM
        "applicable_flags": [],
        "lab_loinc": "4548-4",          # HbA1c LOINC code
        "frequency_days": 180,          # every 6 months
        "priority_base": "high",
        "recommended_action": "Schedule or order an HbA1c follow-up",
        "evidence_labels": {"4548-4": "HbA1c"},
        "result_evaluation": {
            "components": [
                {
                    "loinc": "4548-4",
                    "label": "HbA1c",
                    "comparator": "lt",
                    "target": 8.0,
                    "unit": "%",
                },
            ],
            "control_label": "controlled",
            "uncontrolled_label": "poorly controlled",
            "uncontrolled_action": "Repeat HbA1c in 3 months and review medication regimen",
            "uncontrolled_priority_floor": "high",
        },
    },
    {
        "measure_code": "KED",
        "measure_name": "Kidney Health Evaluation for Patients with Diabetes",
        "description": "Annual eGFR + uACR for diabetic patients, especially those with CKD.",
        "applicable_conditions": ["44054006", "433144002"],  # T2DM + CKD
        "applicable_flags": ["has_ckd"],
        "lab_loinc": "62238-1",         # eGFR LOINC code
        "frequency_days": 365,          # annual
        "priority_base": "high",
        "recommended_action": "Order kidney evaluation labs (eGFR + uACR)",
        "evidence_labels": {"62238-1": "eGFR", "14959-1": "uACR"},
        "result_evaluation": {
            "components": [
                {
                    "loinc": "62238-1",
                    "label": "eGFR",
                    "comparator": "gte",
                    "target": 60.0,
                    "unit": "mL/min/1.73m2",
                },
                {
                    "loinc": "14959-1",
                    "label": "uACR",
                    "comparator": "lt",
                    "target": 30.0,
                    "unit": "mg/g",
                },
            ],
            "control_label": "kidney function stable",
            "uncontrolled_label": "abnormal kidney function",
            "uncontrolled_action": "Schedule nephrology follow-up to review eGFR/uACR results",
            "uncontrolled_priority_floor": "high",
        },
    },
    {
        "measure_code": "CBP",
        "measure_name": "Controlling High Blood Pressure — Diabetes Subset",
        "description": "BP target < 140/90 for diabetic patients with hypertension.",
        "applicable_conditions": ["44054006", "59621000"],  # T2DM + HTN
        "applicable_flags": [],
        "lab_loinc": None,              # No lab — evaluated via vitals/encounter data
        "frequency_days": 365,
        "priority_base": "moderate",
        "recommended_action": "Schedule blood pressure follow-up and confirm control plan",
        "evidence_labels": {},
    },
    {
        "measure_code": "SPD",
        "measure_name": "Statin Therapy for Patients with Diabetes",
        "description": "Diabetic patients aged 40-75 should be on statin therapy.",
        "applicable_conditions": ["44054006"],  # T2DM
        "applicable_flags": [],
        "lab_loinc": "2093-3",          # Total cholesterol (used for gap evaluation)
        "frequency_days": 365,
        "priority_base": "moderate",
        "recommended_action": "Review statin therapy gap and route medication follow-up",
        "evidence_labels": {"2093-3": "Total cholesterol"},
    },
    {
        "measure_code": "EED",
        "measure_name": "Eye Exam for Patients with Diabetes",
        "description": "Annual retinal exam for all diabetic patients.",
        "applicable_conditions": ["44054006"],  # T2DM
        "applicable_flags": [],
        "lab_loinc": None,              # No lab — procedure-based
        "frequency_days": 365,
        "priority_base": "moderate",
        "recommended_action": "Schedule diabetic eye exam outreach",
        "evidence_labels": {},
    },
]
