"""
FHIR R4 Synthetic Patient Bundle Generator.

Generates realistic FHIR R4 patient bundles with:
  - Patient demographics (name, DOB, gender, MRN, source hospital)
  - Conditions / diagnoses  (SNOMED CT + ICD-10 codes)
  - Medications             (RxNorm codes, dosage instructions)
  - Lab observations        (LOINC codes, reference ranges)
  - Allergy intolerances
  - Encounters
  - Clinical notes (DocumentReference with unstructured text)

The generator is biased toward the blueprint's target demo demographic:
  elderly patients (65–85) with Type 2 Diabetes, Chronic Kidney Disease
  stage 3, Essential Hypertension, and Diabetic Peripheral Neuropathy.
  They are prescribed Beta-blockers, Insulin, ACE inhibitors, and Metformin.

A random secondary condition (CHF, COPD, A-fib) is added with 50% probability
to produce realistic comorbidity variation across the patient population.
"""
from __future__ import annotations

import base64
import random
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from faker import Faker

# ---------------------------------------------------------------------------
# Profile type constant (mirrors models.ProfileType values — kept as strings
# here to avoid a circular import with the Pydantic models layer)
# ---------------------------------------------------------------------------

PROFILE_TARGET   = "target"
PROFILE_HEALTHY  = "healthy"
PROFILE_DIABETIC = "diabetic"
PROFILE_CARDIAC  = "cardiac"
PROFILE_MIXED    = "mixed"

# Population weights for MIXED mode: (profile, cumulative_weight)
# target=10%, healthy=60%, diabetic=20%, cardiac=10%
_MIXED_WEIGHTS = [
    (PROFILE_HEALTHY,  0.60),
    (PROFILE_DIABETIC, 0.80),
    (PROFILE_TARGET,   0.90),
    (PROFILE_CARDIAC,  1.00),
]

# ---------------------------------------------------------------------------
# Chronic condition catalogue
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Condition catalogue
# Keys: snomed → used to look up medications below
# ---------------------------------------------------------------------------

CONDITION_CATALOGUE: list[dict[str, Any]] = [
    # ---- Core target profile ----
    {
        "display": "Type 2 diabetes mellitus",
        "snomed": "44054006",
        "icd10": "E11.9",
        "category": "chronic",
    },
    {
        "display": "Chronic kidney disease stage 3",
        "snomed": "433144002",
        "icd10": "N18.3",
        "category": "chronic",
    },
    {
        "display": "Essential hypertension",
        "snomed": "59621000",
        "icd10": "I10",
        "category": "chronic",
    },
    {
        "display": "Diabetic peripheral neuropathy",
        "snomed": "230572002",
        "icd10": "E11.40",
        "category": "chronic",
    },
    # ---- Secondary conditions (added with 50% probability) ----
    {
        "display": "Congestive heart failure",
        "snomed": "42343007",
        "icd10": "I50.9",
        "category": "chronic",
    },
    {
        "display": "Chronic obstructive pulmonary disease",
        "snomed": "13645005",
        "icd10": "J44.1",
        "category": "chronic",
    },
    {
        "display": "Atrial fibrillation",
        "snomed": "49436004",
        "icd10": "I48.91",
        "category": "chronic",
    },
]

# ---------------------------------------------------------------------------
# Medication catalogue  (condition → list of options)
# ---------------------------------------------------------------------------

MEDICATION_CATALOGUE: dict[str, list[dict[str, Any]]] = {
    "44054006": [  # T2DM — Metformin is always added; one insulin is always added
        {"display": "Metformin 500 mg oral tablet",          "rxnorm": "861007",  "dose": "500 mg",      "route": "oral",          "frequency": "twice daily",  "is_metformin": True},
        {"display": "Insulin glargine 100 units/mL injection","rxnorm": "1441254", "dose": "20 units",    "route": "subcutaneous",  "frequency": "once daily at bedtime", "is_insulin": True},
        {"display": "Insulin aspart 100 units/mL injection",  "rxnorm": "1008477", "dose": "10 units",    "route": "subcutaneous",  "frequency": "three times daily with meals", "is_insulin": True},
        {"display": "Empagliflozin 10 mg oral tablet",        "rxnorm": "1545146", "dose": "10 mg",       "route": "oral",          "frequency": "once daily"},
    ],
    "42343007": [  # CHF
        {"display": "Furosemide 40 mg oral tablet",           "rxnorm": "310429",  "dose": "40 mg",       "route": "oral",          "frequency": "once daily"},
        {"display": "Carvedilol 12.5 mg oral tablet",         "rxnorm": "200031",  "dose": "12.5 mg",     "route": "oral",          "frequency": "twice daily",  "is_beta_blocker": True},
        {"display": "Lisinopril 10 mg oral tablet",           "rxnorm": "314076",  "dose": "10 mg",       "route": "oral",          "frequency": "once daily",   "is_ace_inhibitor": True},
    ],
    "13645005": [  # COPD
        {"display": "Tiotropium 18 mcg inhaled capsule",      "rxnorm": "866511",  "dose": "18 mcg",      "route": "inhaled",       "frequency": "once daily"},
        {"display": "Albuterol 90 mcg inhaler",               "rxnorm": "745679",  "dose": "90 mcg",      "route": "inhaled",       "frequency": "as needed"},
        {"display": "Prednisone 10 mg oral tablet",           "rxnorm": "763179",  "dose": "10 mg",       "route": "oral",          "frequency": "once daily"},
    ],
    "59621000": [  # Hypertension — ACE inhibitor is first-line for diabetic/CKD patients
        {"display": "Atenolol 50 mg oral tablet",             "rxnorm": "197381",  "dose": "50 mg",       "route": "oral",          "frequency": "once daily",   "is_beta_blocker": True},
        {"display": "Lisinopril 10 mg oral tablet",           "rxnorm": "314076",  "dose": "10 mg",       "route": "oral",          "frequency": "once daily",   "is_ace_inhibitor": True},
        {"display": "Ramipril 5 mg oral capsule",             "rxnorm": "35208",   "dose": "5 mg",        "route": "oral",          "frequency": "once daily",   "is_ace_inhibitor": True},
        {"display": "Amlodipine 5 mg oral tablet",            "rxnorm": "197361",  "dose": "5 mg",        "route": "oral",          "frequency": "once daily"},
    ],
    "433144002": [  # CKD — ACE inhibitor for renoprotection is standard of care
        {"display": "Ramipril 5 mg oral capsule",             "rxnorm": "35208",   "dose": "5 mg",        "route": "oral",          "frequency": "once daily",   "is_ace_inhibitor": True},
        {"display": "Erythropoietin 4000 units/mL injection", "rxnorm": "1040028", "dose": "4000 units",  "route": "subcutaneous",  "frequency": "weekly"},
        {"display": "Sodium bicarbonate 650 mg oral tablet",  "rxnorm": "1812004", "dose": "650 mg",      "route": "oral",          "frequency": "twice daily"},
    ],
    "230572002": [  # Diabetic peripheral neuropathy
        {"display": "Gabapentin 300 mg oral capsule",         "rxnorm": "310431",  "dose": "300 mg",      "route": "oral",          "frequency": "three times daily"},
        {"display": "Pregabalin 75 mg oral capsule",          "rxnorm": "187832",  "dose": "75 mg",       "route": "oral",          "frequency": "twice daily"},
        {"display": "Duloxetine 60 mg oral capsule",          "rxnorm": "596927",  "dose": "60 mg",       "route": "oral",          "frequency": "once daily"},
    ],
    "49436004": [  # A-fib
        {"display": "Warfarin 5 mg oral tablet",             "rxnorm": "855332",  "dose": "5 mg",        "route": "oral",          "frequency": "once daily"},
        {"display": "Apixaban 5 mg oral tablet",             "rxnorm": "1364430", "dose": "5 mg",        "route": "oral",          "frequency": "twice daily"},
        {"display": "Digoxin 0.125 mg oral tablet",          "rxnorm": "197604",  "dose": "0.125 mg",    "route": "oral",          "frequency": "once daily"},
    ],
}

# ---------------------------------------------------------------------------
# Lab catalogue  (LOINC code → metadata)
# ---------------------------------------------------------------------------

LAB_CATALOGUE: list[dict[str, Any]] = [
    {"loinc": "4548-4",  "display": "Hemoglobin A1c/Hemoglobin.total in Blood",
     "unit": "%", "low": 4.0, "high": 5.6, "abnormal_range": (6.5, 12.0)},
    {"loinc": "2160-0",  "display": "Creatinine [Mass/volume] in Serum or Plasma",
     "unit": "mg/dL", "low": 0.6, "high": 1.2, "abnormal_range": (1.5, 5.0)},
    {"loinc": "2823-3",  "display": "Potassium [Moles/volume] in Serum or Plasma",
     "unit": "mEq/L", "low": 3.5, "high": 5.0, "abnormal_range": (5.5, 7.0)},
    {"loinc": "2947-0",  "display": "Sodium [Moles/volume] in Blood",
     "unit": "mEq/L", "low": 136.0, "high": 145.0, "abnormal_range": (146.0, 155.0)},
    {"loinc": "26515-7","display": "Platelets [#/volume] in Blood",
     "unit": "10^3/uL", "low": 150.0, "high": 400.0, "abnormal_range": (400.0, 900.0)},
    {"loinc": "718-7",  "display": "Hemoglobin [Mass/volume] in Blood",
     "unit": "g/dL", "low": 12.0, "high": 17.5, "abnormal_range": (7.0, 11.9)},
    {"loinc": "2093-3", "display": "Cholesterol [Mass/volume] in Serum or Plasma",
     "unit": "mg/dL", "low": 0.0, "high": 200.0, "abnormal_range": (200.1, 350.0)},
    {"loinc": "10839-9","display": "Troponin I.cardiac [Mass/volume] in Serum or Plasma",
     "unit": "ng/mL", "low": 0.0, "high": 0.04, "abnormal_range": (0.05, 5.0)},
    {"loinc": "2019-8",  "display": "Carbon dioxide [Partial pressure] in Arterial blood",
     "unit": "mmHg",    "low": 35.0,  "high": 45.0,  "abnormal_range": (46.0, 65.0)},
    {"loinc": "32693-4","display": "Lactate [Moles/volume] in Venous blood",
     "unit": "mmol/L",  "low": 0.5,   "high": 2.2,   "abnormal_range": (2.3, 8.0)},
    # ---- Target profile labs ----
    {"loinc": "62238-1","display": "Glomerular filtration rate/1.73 sq M.predicted [Volume Rate/Area] in Serum, Plasma or Blood by Creatinine-based formula (CKD-EPI)",
     "unit": "mL/min/1.73m2", "low": 60.0, "high": 120.0, "abnormal_range": (30.0, 59.9)},
    {"loinc": "14959-1","display": "Microalbumin/Creatinine [Ratio] in Urine",
     "unit": "mg/g",    "low": 0.0,   "high": 30.0,  "abnormal_range": (30.1, 300.0)},
    {"loinc": "1558-6", "display": "Fasting glucose [Mass/volume] in Serum or Plasma",
     "unit": "mg/dL",   "low": 70.0,  "high": 99.0,  "abnormal_range": (126.0, 350.0)},
    {"loinc": "3094-0", "display": "Urea nitrogen [Mass/volume] in Serum or Plasma",
     "unit": "mg/dL",   "low": 7.0,   "high": 20.0,  "abnormal_range": (21.0, 80.0)},
]

# ---------------------------------------------------------------------------
# Allergy catalogue
# ---------------------------------------------------------------------------

ALLERGY_CATALOGUE: list[dict[str, Any]] = [
    {"display": "Penicillin", "rxnorm": "7980",   "reaction": "Anaphylaxis",        "severity": "severe"},
    {"display": "Sulfonamides","rxnorm":"10829",   "reaction": "Skin rash",          "severity": "moderate"},
    {"display": "Codeine",    "rxnorm": "2670",    "reaction": "Nausea and vomiting","severity": "mild"},
    {"display": "Aspirin",    "rxnorm": "1191",    "reaction": "Urticaria",          "severity": "moderate"},
    {"display": "Latex",      "rxnorm": "415483",  "reaction": "Contact dermatitis", "severity": "moderate"},
    {"display": "Shellfish",  "rxnorm": "227493",  "reaction": "Swelling",           "severity": "moderate"},
]

# ---------------------------------------------------------------------------
# Hospital sources
# ---------------------------------------------------------------------------

HOSPITAL_META: dict[str, dict[str, str]] = {
    "st_marys": {
        "name": "St. Mary's Medical Center",
        "ehr": "Epic",
        "format": "FHIR R4",
        "oid": "2.16.840.1.113883.3.100",
    },
    "regional_general": {
        "name": "Regional General Hospital",
        "ehr": "Cerner",
        "format": "FHIR R4",
        "oid": "2.16.840.1.113883.3.200",
    },
    "community_health": {
        "name": "Community Health Partners",
        "ehr": "Legacy",
        "format": "HL7v2→FHIR",
        "oid": "2.16.840.1.113883.3.300",
    },
}


# ---------------------------------------------------------------------------
# Healthy profile — James: post-surgical recovery, no chronic conditions
# ---------------------------------------------------------------------------

_HEALTHY_MEDS: list[dict[str, Any]] = [
    {"display": "Ibuprofen 400 mg oral tablet",       "rxnorm": "310965",  "dose": "400 mg",  "route": "oral", "frequency": "every 6 hours as needed"},
    {"display": "Acetaminophen 500 mg oral tablet",   "rxnorm": "198440",  "dose": "500 mg",  "route": "oral", "frequency": "every 6 hours as needed"},
    {"display": "Naproxen 250 mg oral tablet",        "rxnorm": "849574",  "dose": "250 mg",  "route": "oral", "frequency": "twice daily as needed"},
]

_HEALTHY_CONDITIONS: list[dict[str, Any]] = [
    {
        "display": "Post-procedural recovery",
        "snomed": "308283009",
        "icd10": "Z09",
        "category": "encounter-diagnosis",
    },
    {
        "display": "Knee pain",
        "snomed": "57773001",
        "icd10": "M25.361",
        "category": "encounter-diagnosis",
    },
]

# ---------------------------------------------------------------------------
# Background diabetic profile — T2DM ± HTN, age 45–75
# ---------------------------------------------------------------------------

_DIABETIC_CONDITIONS: list[dict[str, Any]] = [
    {"display": "Type 2 diabetes mellitus", "snomed": "44054006", "icd10": "E11.9",  "category": "chronic"},
    {"display": "Essential hypertension",   "snomed": "59621000", "icd10": "I10",    "category": "chronic"},
]

_DIABETIC_MEDS: list[dict[str, Any]] = [
    {"display": "Metformin 500 mg oral tablet",         "rxnorm": "861007",  "dose": "500 mg",  "route": "oral", "frequency": "twice daily",  "is_metformin": True},
    {"display": "Glipizide 5 mg oral tablet",           "rxnorm": "310488",  "dose": "5 mg",    "route": "oral", "frequency": "once daily"},
    {"display": "Sitagliptin 100 mg oral tablet",       "rxnorm": "593411",  "dose": "100 mg",  "route": "oral", "frequency": "once daily"},
    {"display": "Amlodipine 5 mg oral tablet",          "rxnorm": "197361",  "dose": "5 mg",    "route": "oral", "frequency": "once daily"},
]

# ---------------------------------------------------------------------------
# Background cardiac profile — CHF or COPD, age 55–80
# ---------------------------------------------------------------------------

_CARDIAC_CONDITIONS: list[dict[str, Any]] = [
    {"display": "Congestive heart failure",              "snomed": "42343007", "icd10": "I50.9", "category": "chronic"},
    {"display": "Chronic obstructive pulmonary disease", "snomed": "13645005", "icd10": "J44.1", "category": "chronic"},
]

_CARDIAC_MEDS: dict[str, list[dict[str, Any]]] = {
    "42343007": [  # CHF
        {"display": "Furosemide 40 mg oral tablet",        "rxnorm": "310429", "dose": "40 mg",  "route": "oral",    "frequency": "once daily"},
        {"display": "Carvedilol 12.5 mg oral tablet",      "rxnorm": "200031", "dose": "12.5 mg","route": "oral",    "frequency": "twice daily", "is_beta_blocker": True},
        {"display": "Lisinopril 10 mg oral tablet",        "rxnorm": "314076", "dose": "10 mg",  "route": "oral",    "frequency": "once daily",  "is_ace_inhibitor": True},
    ],
    "13645005": [  # COPD
        {"display": "Tiotropium 18 mcg inhaled capsule",   "rxnorm": "866511", "dose": "18 mcg", "route": "inhaled", "frequency": "once daily"},
        {"display": "Albuterol 90 mcg inhaler",            "rxnorm": "745679", "dose": "90 mcg", "route": "inhaled", "frequency": "as needed"},
    ],
}


NOTE_TEMPLATES: list[str] = [
    (
        "Patient is a {age}-year-old {gender} admitted with worsening shortness of breath and decreased urine output. "
        "Known history of {condition1} and {condition2}. "
        "Currently on {medication}. Vitals on admission: BP 158/92, HR 96, RR 22, SpO2 93% on room air. "
        "Labs notable for creatinine 2.1 mg/dL (baseline 1.8), eGFR 34, potassium 5.3. HbA1c 8.9%. "
        "Patient was started on IV furosemide with improvement in respiratory status. "
        "Endocrinology consulted for insulin titration. "
        "Plan for discharge in 2-3 days with medication adjustment and close nephrology and endocrinology follow-up."
    ),
    (
        "Discharge summary for {age}-year-old {gender} with primary diagnosis of {condition1}. "
        "Secondary diagnoses include {condition2}. "
        "Patient has Type 2 diabetes on insulin and metformin with suboptimal glycemic control (HbA1c 9.1%). "
        "Chronic kidney disease stage 3 with eGFR 38; patient started on ramipril for renoprotection. "
        "Peripheral neuropathy managed with gabapentin. "
        "Patient is being discharged on {medication}. "
        "Outpatient follow-up scheduled in 1 week with primary care, nephrology, and diabetes care team."
    ),
    (
        "Patient presents with increased fatigue, lower extremity numbness, and poor glucose control. "
        "Background of {condition1}, managed with insulin glargine and metformin. "
        "Also carries diagnosis of {condition2} and diabetic peripheral neuropathy. "
        "Recent HbA1c 9.4%. eGFR trending down from 48 to 39 over the past 6 months. "
        "Urine albumin-to-creatinine ratio elevated at 145 mg/g, consistent with diabetic nephropathy. "
        "BP today 162/94 — ACE inhibitor dose uptitrated. "
        "Patient reports tingling and burning in bilateral feet; gabapentin increased to 400 mg TID. "
        "Assessment: poorly controlled Type 2 diabetes with progressive CKD and symptomatic neuropathy."
    ),
    (
        "{age}-year-old {gender} with Type 2 diabetes, CKD stage 3, and hypertension presenting for "
        "routine follow-up with concern for increasing bilateral foot pain and swelling. "
        "Current medications include {medication}. "
        "Fasting glucose this morning 218 mg/dL. Patient reports occasional hypoglycemic episodes in the morning. "
        "BP 148/88 on lisinopril. Heart rate 58 bpm on atenolol — note: resting HR expected to be lower than normal. "
        "Creatinine 1.9 mg/dL, eGFR 36. Potassium 5.1. "
        "Neurological exam reveals decreased sensation to monofilament testing bilateral feet. "
        "Plan: adjust insulin regimen, increase ACE inhibitor, and continue gabapentin for neuropathy."
    ),
]


# ---------------------------------------------------------------------------
# Generator class
# ---------------------------------------------------------------------------

class FHIRPatientGenerator:
    """
    Generates synthetic FHIR R4 patient bundles.

    Profile routing
    ---------------
    target   — Maria: elderly T2DM/CKD/HTN/neuropathy (primary demo patient)
    healthy  — James: young post-surgical, no chronic conditions
    diabetic — Background T2DM cohort (HEDIS care gap population)
    cardiac  — Background CHF/COPD cohort
    mixed    — Random mix using population weights (60/20/10/10)
    """

    def __init__(self, seed: int | None = None):
        self.rng = random.Random(seed)
        self.faker = Faker()
        if seed is not None:
            Faker.seed(seed)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def generate_patient(
        self,
        hospital: str | None = None,
        profile_type: str = PROFILE_TARGET,
    ) -> dict[str, Any]:
        """Return a complete FHIR R4 Bundle (transaction) for one patient."""
        # Resolve MIXED to a concrete profile
        if profile_type == PROFILE_MIXED:
            r = self.rng.random()
            for profile, threshold in _MIXED_WEIGHTS:
                if r <= threshold:
                    profile_type = profile
                    break

        hospital_key = hospital or self.rng.choice(list(HOSPITAL_META.keys()))
        patient_id   = str(uuid.uuid4())

        # Demographics vary by profile
        if profile_type == PROFILE_HEALTHY:
            gender = self.rng.choice(["male", "female"])
            dob    = self._random_dob(min_age=25, max_age=40)
        elif profile_type == PROFILE_DIABETIC:
            gender = self.rng.choice(["male", "female"])
            dob    = self._random_dob(min_age=45, max_age=75)
        elif profile_type == PROFILE_CARDIAC:
            gender = self.rng.choice(["male", "female"])
            dob    = self._random_dob(min_age=55, max_age=80)
        else:  # target
            gender = self.rng.choice(["male", "female"])
            dob    = self._random_dob(min_age=65, max_age=85)

        age  = self._calculate_age(dob)
        name = self._generate_name(gender)
        mrn  = f"MRN{self.rng.randint(100000, 999999)}"

        conditions = self._pick_conditions(profile_type)
        meds       = self._pick_medications(conditions, profile_type)
        labs       = self._generate_labs(profile_type)
        allergies  = self._maybe_add_allergies()
        encounter  = self._generate_encounter(patient_id)
        note       = self._generate_note(age, gender, conditions, meds)

        # Operational fields (not FHIR-spec but used by MongoDB indexes and vitals simulator)
        meta = {
            "patient_id":       patient_id,
            "mrn":              mrn,
            "source_hospital":  hospital_key,
            "hospital_name":    HOSPITAL_META[hospital_key]["name"],
            "ingested_at":      datetime.now(timezone.utc).isoformat(),
            "profile_type":     profile_type,
            "has_beta_blocker": any(m.get("is_beta_blocker")   for m in meds),
            "has_insulin":      any(m.get("is_insulin")        for m in meds),
            "has_ace_inhibitor":any(m.get("is_ace_inhibitor")  for m in meds),
            "condition_codes":  [c["snomed"] for c in conditions],
        }

        bundle = self._build_bundle(
            patient_id=patient_id,
            name=name,
            gender=gender,
            dob=dob,
            mrn=mrn,
            hospital_key=hospital_key,
            conditions=conditions,
            medications=meds,
            labs=labs,
            allergies=allergies,
            encounter=encounter,
            note=note,
        )

        return {"meta": meta, "bundle": bundle}

    # ------------------------------------------------------------------
    # Bundle assembly
    # ------------------------------------------------------------------

    def _build_bundle(
        self,
        patient_id: str,
        name: dict,
        gender: str,
        dob: date,
        mrn: str,
        hospital_key: str,
        conditions: list[dict],
        medications: list[dict],
        labs: list[dict],
        allergies: list[dict],
        encounter: dict,
        note: str,
    ) -> dict[str, Any]:
        hospital = HOSPITAL_META[hospital_key]
        entries: list[dict[str, Any]] = []

        # --- Patient resource ---
        patient_resource = {
            "resourceType": "Patient",
            "id": patient_id,
            "meta": {"source": f"urn:oid:{hospital['oid']}"},
            "identifier": [
                {
                    "use": "official",
                    "system": f"urn:oid:{hospital['oid']}",
                    "value": mrn,
                }
            ],
            "name": [
                {
                    "use": "official",
                    "family": name["family"],
                    "given": [name["given"]],
                }
            ],
            "gender": gender,
            "birthDate": dob.isoformat(),
            "active": True,
        }
        entries.append(self._bundle_entry(f"Patient/{patient_id}", patient_resource))

        # --- Condition resources ---
        for cond in conditions:
            cond_id = str(uuid.uuid4())
            condition_resource = {
                "resourceType": "Condition",
                "id": cond_id,
                "clinicalStatus": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                            "code": "active",
                        }
                    ]
                },
                "verificationStatus": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                            "code": "confirmed",
                        }
                    ]
                },
                "category": [
                    {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/condition-category",
                                "code": "problem-list-item",
                                "display": "Problem List Item",
                            }
                        ]
                    }
                ],
                "code": {
                    "coding": [
                        {
                            "system": "http://snomed.info/sct",
                            "code": cond["snomed"],
                            "display": cond["display"],
                        },
                        {
                            "system": "http://hl7.org/fhir/sid/icd-10-cm",
                            "code": cond["icd10"],
                        },
                    ],
                    "text": cond["display"],
                },
                "subject": {"reference": f"Patient/{patient_id}"},
                "onsetDateTime": (
                    datetime.now(timezone.utc) - timedelta(days=self.rng.randint(180, 3650))
                ).isoformat(),
            }
            entries.append(self._bundle_entry(f"Condition/{cond_id}", condition_resource))

        # --- MedicationRequest resources ---
        for med in medications:
            med_id = str(uuid.uuid4())
            med_resource = {
                "resourceType": "MedicationRequest",
                "id": med_id,
                "status": "active",
                "intent": "order",
                "medicationCodeableConcept": {
                    "coding": [
                        {
                            "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
                            "code": med["rxnorm"],
                            "display": med["display"],
                        }
                    ],
                    "text": med["display"],
                },
                "subject": {"reference": f"Patient/{patient_id}"},
                "dosageInstruction": [
                    {
                        "text": f"{med['dose']} {med['route']} {med['frequency']}",
                        "timing": {"code": {"text": med["frequency"]}},
                        "route": {
                            "coding": [{"system": "http://snomed.info/sct", "display": med["route"]}]
                        },
                        "doseAndRate": [
                            {
                                "doseQuantity": {
                                    "value": float(med["dose"].split()[0].replace("mcg", "").replace("mg", "").replace("units", "")),
                                    "unit": med["dose"].split()[-1] if len(med["dose"].split()) > 1 else "unit",
                                }
                            }
                        ],
                    }
                ],
            }
            entries.append(self._bundle_entry(f"MedicationRequest/{med_id}", med_resource))

        # --- Lab Observation resources ---
        for lab in labs:
            obs_id = str(uuid.uuid4())
            obs_resource = {
                "resourceType": "Observation",
                "id": obs_id,
                "status": "final",
                "category": [
                    {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                                "code": "laboratory",
                                "display": "Laboratory",
                            }
                        ]
                    }
                ],
                "code": {
                    "coding": [
                        {
                            "system": "http://loinc.org",
                            "code": lab["loinc"],
                            "display": lab["display"],
                        }
                    ],
                    "text": lab["display"],
                },
                "subject": {"reference": f"Patient/{patient_id}"},
                "effectiveDateTime": (
                    datetime.now(timezone.utc) - timedelta(hours=self.rng.randint(1, 72))
                ).isoformat(),
                "valueQuantity": {
                    "value": round(lab["value"], 2),
                    "unit": lab["unit"],
                    "system": "http://unitsofmeasure.org",
                },
                "referenceRange": [
                    {
                        "low":  {"value": lab["ref_low"],  "unit": lab["unit"]},
                        "high": {"value": lab["ref_high"], "unit": lab["unit"]},
                    }
                ],
                "interpretation": [
                    {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                                "code": lab["interpretation"],
                            }
                        ]
                    }
                ],
            }
            entries.append(self._bundle_entry(f"Observation/{obs_id}", obs_resource))

        # --- AllergyIntolerance resources ---
        for allergy in allergies:
            allergy_id = str(uuid.uuid4())
            allergy_resource = {
                "resourceType": "AllergyIntolerance",
                "id": allergy_id,
                "clinicalStatus": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
                            "code": "active",
                        }
                    ]
                },
                "verificationStatus": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                            "code": "confirmed",
                        }
                    ]
                },
                "type": "allergy",
                "category": ["medication"],
                "criticality": "high" if allergy["severity"] == "severe" else "low",
                "code": {
                    "coding": [
                        {
                            "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
                            "code": allergy["rxnorm"],
                            "display": allergy["display"],
                        }
                    ],
                    "text": allergy["display"],
                },
                "patient": {"reference": f"Patient/{patient_id}"},
                "reaction": [
                    {
                        "manifestation": [
                            {
                                "coding": [
                                    {
                                        "system": "http://snomed.info/sct",
                                        "display": allergy["reaction"],
                                    }
                                ]
                            }
                        ],
                        "severity": allergy["severity"],
                    }
                ],
            }
            entries.append(self._bundle_entry(f"AllergyIntolerance/{allergy_id}", allergy_resource))

        # --- Encounter resource ---
        enc_id = str(uuid.uuid4())
        encounter_resource = {
            "resourceType": "Encounter",
            "id": enc_id,
            "status": encounter["status"],
            "class": {
                "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                "code": encounter["class_code"],
                "display": encounter["class_display"],
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "period": encounter["period"],
            "serviceProvider": {
                "display": HOSPITAL_META[hospital_key]["name"],
            },
        }
        entries.append(self._bundle_entry(f"Encounter/{enc_id}", encounter_resource))

        # --- DocumentReference (clinical note) ---
        doc_id = str(uuid.uuid4())
        doc_resource = {
            "resourceType": "DocumentReference",
            "id": doc_id,
            "status": "current",
            "type": {
                "coding": [
                    {
                        "system": "http://loinc.org",
                        "code": "11506-3",
                        "display": "Progress note",
                    }
                ]
            },
            "subject": {"reference": f"Patient/{patient_id}"},
            "date": datetime.now(timezone.utc).isoformat(),
            "content": [
                {
                    "attachment": {
                        "contentType": "text/plain",
                        "data": base64.b64encode(note.encode("utf-8")).decode("ascii"),
                        "title": "Clinical Note",
                    }
                }
            ],
        }
        entries.append(self._bundle_entry(f"DocumentReference/{doc_id}", doc_resource))

        return {
            "resourceType": "Bundle",
            "id": str(uuid.uuid4()),
            "type": "transaction",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "entry": entries,
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _bundle_entry(full_url: str, resource: dict) -> dict:
        return {
            "fullUrl": f"urn:uuid:{full_url.split('/')[-1]}",
            "resource": resource,
            "request": {"method": "PUT", "url": full_url},
        }

    def _random_dob(self, min_age: int = 65, max_age: int = 85) -> date:
        today = date.today()
        days_range = (max_age - min_age) * 365
        offset = self.rng.randint(min_age * 365, min_age * 365 + days_range)
        return today - timedelta(days=offset)

    @staticmethod
    def _calculate_age(dob: date) -> int:
        today = date.today()
        return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

    def _generate_name(self, gender: str) -> dict[str, str]:
        if gender == "male":
            given = self.faker.first_name_male()
        else:
            given = self.faker.first_name_female()
        return {"given": given, "family": self.faker.last_name()}

    def _pick_conditions(self, profile_type: str = PROFILE_TARGET) -> list[dict]:
        if profile_type == PROFILE_HEALTHY:
            return list(_HEALTHY_CONDITIONS)

        if profile_type == PROFILE_DIABETIC:
            # Always T2DM; 60% chance of also having hypertension
            conds = [c for c in _DIABETIC_CONDITIONS if c["snomed"] == "44054006"]
            if self.rng.random() < 0.60:
                conds.append(next(c for c in _DIABETIC_CONDITIONS if c["snomed"] == "59621000"))
            return conds

        if profile_type == PROFILE_CARDIAC:
            # Pick one of CHF or COPD
            return [self.rng.choice(_CARDIAC_CONDITIONS)]

        # target — always the full core quartet + optional secondary
        core_snomed = {"44054006", "433144002", "59621000", "230572002"}
        secondary   = [c for c in CONDITION_CATALOGUE if c["snomed"] not in core_snomed]
        core        = [c for c in CONDITION_CATALOGUE if c["snomed"] in core_snomed]
        result      = list(core)
        if self.rng.random() < 0.50:
            result.append(self.rng.choice(secondary))
        return result

    def _pick_medications(
        self,
        conditions: list[dict],
        profile_type: str = PROFILE_TARGET,
    ) -> list[dict]:
        if profile_type == PROFILE_HEALTHY:
            return [self.rng.choice(_HEALTHY_MEDS)]

        if profile_type == PROFILE_DIABETIC:
            meds: list[dict] = []
            seen: set[str]   = set()
            # Always metformin
            metformin = next(m for m in _DIABETIC_MEDS if m.get("is_metformin"))
            meds.append(metformin)
            seen.add(metformin["rxnorm"])
            # One more non-metformin option
            others = [m for m in _DIABETIC_MEDS if not m.get("is_metformin") and m["rxnorm"] not in seen]
            if others:
                meds.append(self.rng.choice(others))
            return meds

        if profile_type == PROFILE_CARDIAC:
            snomed = conditions[0]["snomed"]
            options = _CARDIAC_MEDS.get(snomed, [])
            return [self.rng.choice(options)] if options else []

        # target — always metformin + one insulin; mandatory beta-blocker
        # (Atenolol) + ACE inhibitor (Lisinopril); one med per other condition
        meds = []
        seen_rxnorm: set[str] = set()
        for cond in conditions:
            snomed  = cond["snomed"]
            options = MEDICATION_CATALOGUE.get(snomed, [])
            if not options:
                continue
            if snomed == "44054006":  # T2DM — metformin + one insulin
                for med in options:
                    if med.get("is_metformin") or med.get("is_insulin"):
                        if med["rxnorm"] not in seen_rxnorm:
                            if med.get("is_insulin") and any(m.get("is_insulin") for m in meds):
                                continue
                            seen_rxnorm.add(med["rxnorm"])
                            meds.append(med)
            elif snomed == "59621000":  # Hypertension — always Atenolol + ACE inhibitor
                for med in options:
                    if med.get("is_beta_blocker") or med.get("is_ace_inhibitor"):
                        if med["rxnorm"] not in seen_rxnorm:
                            # Only one ACE inhibitor
                            if med.get("is_ace_inhibitor") and any(m.get("is_ace_inhibitor") for m in meds):
                                continue
                            seen_rxnorm.add(med["rxnorm"])
                            meds.append(med)
            else:
                med = self.rng.choice(options)
                if med["rxnorm"] not in seen_rxnorm:
                    seen_rxnorm.add(med["rxnorm"])
                    meds.append(med)
        return meds

    def _generate_labs(self, profile_type: str = PROFILE_TARGET) -> list[dict]:
        """Healthy patients get fewer labs and near-normal values; others get the full set."""
        if profile_type == PROFILE_HEALTHY:
            # Only a basic metabolic panel — all normal
            basic = [l for l in LAB_CATALOGUE if l["loinc"] in ("2947-0", "2823-3", "2160-0")]
            return [
                {**lab, "value": round(self.rng.uniform(lab["low"], lab["high"]), 2),
                 "ref_low": lab["low"], "ref_high": lab["high"], "interpretation": "N"}
                for lab in basic
            ]

        # All other profiles — standard abnormality logic
        n = self.rng.randint(4, 8) if profile_type != PROFILE_TARGET else self.rng.randint(6, 10)
        selected = self.rng.sample(LAB_CATALOGUE, min(n, len(LAB_CATALOGUE)))
        labs = []
        for lab in selected:
            abnormal = self.rng.random() < 0.30
            if abnormal:
                value = round(self.rng.uniform(*lab["abnormal_range"]), 2)
                interpretation = "H" if value > lab["high"] else "L"
            else:
                value = round(self.rng.uniform(lab["low"], lab["high"]), 2)
                interpretation = "N"
            labs.append(
                {**lab, "value": value,
                 "ref_low": lab["low"], "ref_high": lab["high"],
                 "interpretation": interpretation}
            )
        return labs

    def _maybe_add_allergies(self) -> list[dict]:
        if self.rng.random() < 0.40:  # 40 % of patients have at least one allergy
            count = self.rng.randint(1, 2)
            return self.rng.sample(ALLERGY_CATALOGUE, count)
        return []

    def _generate_encounter(self, patient_id: str) -> dict:
        days_ago = self.rng.randint(0, 30)
        admit_dt = datetime.now(timezone.utc) - timedelta(days=days_ago)
        if days_ago == 0:
            status = "in-progress"
            period: dict[str, Any] = {"start": admit_dt.isoformat()}
        else:
            discharge_dt = admit_dt + timedelta(days=self.rng.randint(1, 5))
            status = "finished"
            period = {
                "start": admit_dt.isoformat(),
                "end": discharge_dt.isoformat(),
            }
        return {
            "status": status,
            "class_code": "IMP",
            "class_display": "inpatient encounter",
            "period": period,
        }

    def _generate_note(
        self,
        age: int,
        gender: str,
        conditions: list[dict],
        medications: list[dict],
    ) -> str:
        template = self.rng.choice(NOTE_TEMPLATES)
        gender_noun = "male" if gender == "male" else "female"
        cond1 = conditions[0]["display"] if conditions else "chronic condition"
        cond2 = conditions[1]["display"] if len(conditions) > 1 else "hypertension"
        med = medications[0]["display"] if medications else "current medications"
        return template.format(
            age=age,
            gender=gender_noun,
            condition1=cond1,
            condition2=cond2,
            medication=med,
        )
