"""
HEDIS Care Gap measure definitions for the demo.

5 measures targeting the Type 2 Diabetes + CKD cohort:
1. CDC-HBA  — Comprehensive Diabetes Care: HbA1c Testing
2. KED      — Kidney Health Evaluation for Patients with Diabetes
3. CBP      — Controlling High Blood Pressure (Diabetes subset)
4. SPD      — Statin Therapy for Patients with Diabetes
5. EED      — Eye Exam for Patients with Diabetes
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
    },
]
