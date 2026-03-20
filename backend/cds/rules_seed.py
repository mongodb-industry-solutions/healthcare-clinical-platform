"""
CDS Rules seed data.

Contains the 5 CDS rules defined in the project schema:
1. cds_beta_blocker_hr      — Contextual tachycardia for beta-blocker patients
2. cds_hypoglycemia          — Multi-factor hypoglycemia detection
3. cds_ckd_respiratory       — CKD metabolic acidosis / decompensation
4. cds_sepsis_warning        — Modified SIRS + diabetes risk amplifiers
5. cds_comparative_context   — Same vitals, different severity by profile
"""

CDS_RULES: list[dict] = [
    # -----------------------------------------------------------------
    # Rule 1: Beta-Blocker–Aware Tachycardia
    # -----------------------------------------------------------------
    {
        "rule_id": "cds_beta_blocker_hr",
        "name": "Contextual Heart Rate Alert — Beta-Blocker Aware",
        "version": 1,
        "enabled": True,
        "applicability": {
            "conditions": [],
            "medications": ["beta_blocker"],
            "flags": ["has_beta_blocker"],
            "min_age": None,
            "max_age": None,
            "profile_types": None,
        },
        "trigger": {
            "vital": "heart_rate",
            "operator": ">",
            "threshold": 90,
            "use_personalized_threshold": True,
            "sustained_minutes": 15,
        },
        "alert_template": {
            "title": "Elevated HR on Beta-Blocker Therapy",
            "severity": "high",
            "alert_type": "threshold_breach",
            "reasoning": (
                "Patient is on {medication_name}. Expected resting HR: 55-75 bpm. "
                "Current HR of {value} bpm is significantly elevated despite beta-blockade."
            ),
            "suggested_actions": [
                "Check blood glucose",
                "Assess for signs of infection",
                "Verify medication compliance",
                "Consider 12-lead ECG",
            ],
            "hedis_measure": None,
            "davinci_profile": "CDS Hooks patient-view",
        },
    },

    # -----------------------------------------------------------------
    # Rule 2: Multi-Factor Hypoglycemia Detection
    # -----------------------------------------------------------------
    {
        "rule_id": "cds_hypoglycemia",
        "name": "Multi-Factor Hypoglycemia Detection — Insulin + Elderly",
        "version": 1,
        "enabled": True,
        "applicability": {
            "conditions": ["44054006"],          # T2DM
            "medications": ["insulin"],
            "flags": ["has_insulin"],
            "min_age": 65,
            "max_age": None,
            "profile_types": None,
        },
        "trigger": {
            "vital": "heart_rate",
            "operator": "spike_pct",
            "threshold": 20,                     # >20% spike from 2h baseline
            "use_personalized_threshold": False,
            "sustained_minutes": 0,
        },
        "alert_template": {
            "title": "Suspected Hypoglycemic Episode",
            "severity": "critical",
            "alert_type": "multi_factor",
            "reasoning": (
                "Patient has T2DM, is on insulin, and is ≥65 years old. "
                "HR spiked >{threshold}% above 2-hour baseline ({baseline_hr} → {value} bpm), "
                "activity decreased suddenly, and SpO2 remains ≥{spo2_floor}%{spo2_floor_note}. "
                "This multi-factor pattern is consistent with a hypoglycemic episode."
            ),
            "suggested_actions": [
                "Immediate blood glucose check",
                "Administer 15g fast-acting carbohydrate if BG < 70 mg/dL",
                "Review insulin dosing schedule",
                "Consider continuous glucose monitor referral",
                "Notify endocrinology",
            ],
            "hedis_measure": "CDC-HBA",
            "davinci_profile": "CDS Hooks patient-view",
        },
    },

    # -----------------------------------------------------------------
    # Rule 3: CKD Metabolic Acidosis / Respiratory Compensation
    # -----------------------------------------------------------------
    {
        "rule_id": "cds_ckd_respiratory",
        "name": "CKD Respiratory Compensation — Metabolic Acidosis Warning",
        "version": 1,
        "enabled": True,
        "applicability": {
            "conditions": ["433144002", "44054006"],  # CKD + T2DM
            "medications": [],
            "flags": ["has_ckd"],
            "min_age": None,
            "max_age": None,
            "profile_types": None,
        },
        "trigger": {
            "vital": "respiratory_rate",
            "operator": ">",
            "threshold": 22,
            "use_personalized_threshold": True,
            "sustained_minutes": 30,
        },
        "alert_template": {
            "title": "Elevated Respiratory Rate — CKD Metabolic Acidosis",
            "severity": "high",
            "alert_type": "trend_based",
            "reasoning": (
                "Patient has CKD Stage 3 + T2DM. Respiratory rate of {value} breaths/min "
                "has been sustained above threshold for >{sustained_minutes} minutes with "
                "an increasing 4-hour trend. This pattern suggests metabolic acidosis "
                "with respiratory compensation (Kussmaul breathing). "
                "Most recent eGFR: {egfr_value} mL/min."
            ),
            "suggested_actions": [
                "STAT basic metabolic panel (BMP)",
                "Arterial blood gas analysis",
                "Check serum bicarbonate and potassium",
                "Nephrology consult if eGFR < 30",
                "Review ACE inhibitor dosing",
            ],
            "hedis_measure": "KED",
            "davinci_profile": "CDS Hooks patient-view",
        },
    },

    # -----------------------------------------------------------------
    # Rule 4: Sepsis Warning — Diabetes + Age + Modified SIRS
    # -----------------------------------------------------------------
    {
        "rule_id": "cds_sepsis_warning",
        "name": "Early Sepsis Warning — Diabetes Risk-Amplified",
        "version": 1,
        "enabled": True,
        "applicability": {
            "conditions": ["44054006"],  # T2DM
            "medications": [],
            "flags": [],
            "min_age": 65,
            "max_age": None,
            "profile_types": None,
        },
        "trigger": {
            "vital": None,           # Composite: evaluated across multiple vitals
            "operator": "sirs_composite",
            "threshold": 3,          # ≥3 modified SIRS criteria
            "use_personalized_threshold": False,
            "sustained_minutes": 0,
        },
        "alert_template": {
            "title": "Sepsis Warning — Diabetes Risk Amplified",
            "severity": "critical",
            "alert_type": "multi_factor",
            "reasoning": (
                "Patient is ≥65 with T2DM. {sirs_count}/4 modified SIRS criteria met: "
                "{sirs_details}. Risk amplifiers present: {risk_amplifiers}. "
                "Diabetic patients have impaired immune response; early intervention is critical."
            ),
            "suggested_actions": [
                "STAT blood cultures x2",
                "STAT lactate level",
                "Broad-spectrum antibiotics within 1 hour",
                "IV fluid resuscitation (30 mL/kg crystalloid)",
                "Activate sepsis bundle protocol",
                "Consider ICU transfer",
            ],
            "hedis_measure": None,
            "davinci_profile": "CDS Hooks patient-view",
        },
    },

    # -----------------------------------------------------------------
    # Rule 5: Comparative Context (Maria vs James demo)
    # -----------------------------------------------------------------
    {
        "rule_id": "cds_comparative_context",
        "name": "Comparative Context Alert — Same Vitals, Different Response",
        "version": 1,
        "enabled": True,
        "applicability": {
            "conditions": [],
            "medications": [],
            "flags": [],
            "min_age": None,
            "max_age": None,
            "profile_types": None,   # applies to all — severity differs at evaluation time
        },
        "trigger": {
            "vital": "heart_rate",
            "operator": ">",
            "threshold": 100,           # generic high-HR threshold
            "use_personalized_threshold": True,
            "sustained_minutes": 10,
        },
        "alert_template": {
            "title": "Heart Rate Elevated — Context-Dependent Severity",
            "severity": "moderate",      # base severity; overridden at evaluation time
            "alert_type": "comparative",
            "reasoning": (
                "Same vital signs produce different clinical significance. "
                "HR {value} bpm: {context_explanation}"
            ),
            "suggested_actions": [
                "Review in context of patient's medication list",
                "Compare with cohort-matched baselines",
            ],
            "hedis_measure": None,
            "davinci_profile": "CDS Hooks patient-view",
        },
    },
]
