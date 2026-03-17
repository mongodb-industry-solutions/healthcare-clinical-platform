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

The generator is Synthea-compatible in spirit — it targets the same chronic-
disease population (T2DM, CHF, COPD, hypertension) that healthcare companies
monitors with wearable patches.
"""
from __future__ import annotations

import base64
import random
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from faker import Faker

# ---------------------------------------------------------------------------
# Chronic condition catalogue
# ---------------------------------------------------------------------------

CONDITION_CATALOGUE: list[dict[str, Any]] = [
    {
        "display": "Type 2 diabetes mellitus",
        "snomed": "44054006",
        "icd10": "E11.9",
        "category": "chronic",
    },
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
        "display": "Essential hypertension",
        "snomed": "59621000",
        "icd10": "I10",
        "category": "chronic",
    },
    {
        "display": "Chronic kidney disease stage 3",
        "snomed": "433144002",
        "icd10": "N18.3",
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
    "44054006": [  # T2DM
        {"display": "Metformin 500 mg oral tablet", "rxnorm": "861007", "dose": "500 mg", "route": "oral", "frequency": "twice daily"},
        {"display": "Glipizide 5 mg oral tablet",   "rxnorm": "310488", "dose": "5 mg",   "route": "oral", "frequency": "once daily"},
        {"display": "Empagliflozin 10 mg oral tablet","rxnorm":"1545146","dose":"10 mg",  "route": "oral", "frequency": "once daily"},
    ],
    "42343007": [  # CHF
        {"display": "Furosemide 40 mg oral tablet",  "rxnorm": "310429", "dose": "40 mg", "route": "oral", "frequency": "once daily"},
        {"display": "Carvedilol 12.5 mg oral tablet","rxnorm": "200031", "dose": "12.5 mg","route":"oral","frequency": "twice daily",
         "is_beta_blocker": True},
        {"display": "Lisinopril 10 mg oral tablet",  "rxnorm": "314076", "dose": "10 mg", "route": "oral", "frequency": "once daily"},
    ],
    "13645005": [  # COPD
        {"display": "Tiotropium 18 mcg inhaled capsule","rxnorm":"866511","dose":"18 mcg","route":"inhaled","frequency":"once daily"},
        {"display": "Albuterol 90 mcg inhaler",       "rxnorm": "745679", "dose": "90 mcg","route":"inhaled","frequency":"as needed"},
        {"display": "Prednisone 10 mg oral tablet",   "rxnorm": "763179", "dose": "10 mg", "route": "oral", "frequency": "once daily"},
    ],
    "59621000": [  # Hypertension
        {"display": "Atenolol 50 mg oral tablet",    "rxnorm": "197381", "dose": "50 mg", "route": "oral", "frequency": "once daily",
         "is_beta_blocker": True},
        {"display": "Amlodipine 5 mg oral tablet",   "rxnorm": "197361", "dose": "5 mg",  "route": "oral", "frequency": "once daily"},
        {"display": "Losartan 50 mg oral tablet",    "rxnorm": "979485", "dose": "50 mg", "route": "oral", "frequency": "once daily"},
    ],
    "433144002": [  # CKD
        {"display": "Erythropoietin 4000 units/mL injection","rxnorm":"1040028","dose":"4000 units","route":"subcutaneous","frequency":"weekly"},
        {"display": "Sodium bicarbonate 650 mg oral tablet","rxnorm":"1812004","dose":"650 mg","route":"oral","frequency":"twice daily"},
    ],
    "49436004": [  # A-fib
        {"display": "Warfarin 5 mg oral tablet",     "rxnorm": "855332", "dose": "5 mg",  "route": "oral", "frequency": "once daily"},
        {"display": "Apixaban 5 mg oral tablet",     "rxnorm":"1364430", "dose": "5 mg",  "route": "oral", "frequency": "twice daily"},
        {"display": "Digoxin 0.125 mg oral tablet",  "rxnorm": "197604", "dose": "0.125 mg","route":"oral","frequency":"once daily"},
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
    {"loinc": "2019-8", "display": "Carbon dioxide [Partial pressure] in Arterial blood",
     "unit": "mmHg", "low": 35.0, "high": 45.0, "abnormal_range": (46.0, 65.0)},
    {"loinc": "32693-4","display": "Lactate [Moles/volume] in Venous blood",
     "unit": "mmol/L", "low": 0.5, "high": 2.2, "abnormal_range": (2.3, 8.0)},
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
# Clinical note templates
# ---------------------------------------------------------------------------

NOTE_TEMPLATES: list[str] = [
    (
        "Patient is a {age}-year-old {gender} admitted with worsening shortness of breath. "
        "Known history of {condition1} and {condition2}. "
        "Currently on {medication}. Vitals on admission: BP 150/90, HR 98, RR 22, SpO2 94% on room air. "
        "Labs notable for elevated creatinine at 1.8 mg/dL. "
        "Patient was started on IV furosemide with improvement in symptoms. "
        "Plan for discharge in 2-3 days with medication adjustment and close outpatient follow-up."
    ),
    (
        "Discharge summary for {age}-year-old {gender} with primary diagnosis of {condition1}. "
        "Secondary diagnoses include {condition2}. "
        "Hospital course was complicated by fluid overload requiring aggressive diuresis. "
        "Patient is being discharged on {medication}. "
        "Outpatient follow-up scheduled in 1 week. Patient educated on daily weight monitoring "
        "and instructed to call if weight increases more than 2 lbs in 24 hours or 5 lbs in a week."
    ),
    (
        "Patient presents with chief complaint of increased fatigue and decreased exercise tolerance. "
        "Background of {condition1}, managed with {medication}. "
        "Also carries diagnosis of {condition2}. "
        "Echocardiogram from last month showed EF of 35%. "
        "HbA1c at last visit was 8.2%. "
        "Patient denies chest pain or syncope. "
        "Physical exam reveals bilateral lower-extremity edema grade 2+. "
        "Assessment: poorly controlled {condition1} with signs of volume overload. Plan to uptitrate diuretic therapy."
    ),
]


# ---------------------------------------------------------------------------
# Generator class
# ---------------------------------------------------------------------------

class FHIRPatientGenerator:
    """
    Generates synthetic FHIR R4 patient bundles suitable for the MedWatch demo.

    Each patient is assigned 2–4 chronic conditions drawn from the catalogue.
    Medications are selected based on those conditions. Labs reflect realistic
    values, with a ~30 % chance of an abnormal result per analyte.
    """

    def __init__(self, seed: int | None = None):
        self.rng = random.Random(seed)
        self.faker = Faker()
        if seed is not None:
            Faker.seed(seed)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def generate_patient(self, hospital: str | None = None) -> dict[str, Any]:
        """Return a complete FHIR R4 Bundle (transaction) for one patient."""
        hospital_key = hospital or self.rng.choice(list(HOSPITAL_META.keys()))
        patient_id = str(uuid.uuid4())

        # Core demographics
        gender = self.rng.choice(["male", "female"])
        dob      = self._random_dob(min_age=45, max_age=85)
        age      = self._calculate_age(dob)
        name     = self._generate_name(gender)
        mrn      = f"MRN{self.rng.randint(100000, 999999)}"

        # Clinical selections
        conditions  = self._pick_conditions()
        meds        = self._pick_medications(conditions)
        labs        = self._generate_labs()
        allergies   = self._maybe_add_allergies()
        encounter   = self._generate_encounter(patient_id)
        note        = self._generate_note(age, gender, conditions, meds)

        # Operational fields (not FHIR-spec but used by MongoDB indexes)
        meta = {
            "patient_id": patient_id,
            "mrn": mrn,
            "source_hospital": hospital_key,
            "hospital_name": HOSPITAL_META[hospital_key]["name"],
            "ingested_at": datetime.now(timezone.utc).isoformat(),
            "has_beta_blocker": any(m.get("is_beta_blocker") for m in meds),
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

    def _random_dob(self, min_age: int = 45, max_age: int = 85) -> date:
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

    def _pick_conditions(self) -> list[dict]:
        count = self.rng.randint(2, 4)
        return self.rng.sample(CONDITION_CATALOGUE, count)

    def _pick_medications(self, conditions: list[dict]) -> list[dict]:
        meds: list[dict] = []
        seen_rxnorm: set[str] = set()
        for cond in conditions:
            snomed = cond["snomed"]
            options = MEDICATION_CATALOGUE.get(snomed, [])
            if options:
                med = self.rng.choice(options)
                if med["rxnorm"] not in seen_rxnorm:
                    seen_rxnorm.add(med["rxnorm"])
                    meds.append(med)
        return meds

    def _generate_labs(self) -> list[dict]:
        labs = []
        selected = self.rng.sample(LAB_CATALOGUE, self.rng.randint(4, 8))
        for lab in selected:
            abnormal = self.rng.random() < 0.30  # 30 % chance of abnormal
            if abnormal:
                value = round(self.rng.uniform(*lab["abnormal_range"]), 2)
                interpretation = "H" if value > lab["high"] else "L"
            else:
                value = round(self.rng.uniform(lab["low"], lab["high"]), 2)
                interpretation = "N"
            labs.append(
                {
                    **lab,
                    "value": value,
                    "ref_low": lab["low"],
                    "ref_high": lab["high"],
                    "interpretation": interpretation,
                }
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
