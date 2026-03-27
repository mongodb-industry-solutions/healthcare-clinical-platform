"""
Demo Setup Script — populates the full MedWatch pipeline with one command.

Usage:
    1. Start the backend:  cd backend && uvicorn main:app --reload
    2. Run this script:    python backend/scripts/seed_demo.py

Pipeline:
    generate patients  →  generate vitals  →  materialize Patient 360s
    →  seed CDS rules  →  compute thresholds  →  evaluate all  →  compute care gaps
"""
from __future__ import annotations

import sys
import time
from typing import Any

import requests

BASE_URL = "http://localhost:8000"

PATIENT_BATCHES: list[dict[str, Any]] = [
    {"count": 2, "profile_type": "target",   "seed": 42},
    {"count": 3, "profile_type": "healthy",  "seed": 100},
    {"count": 2, "profile_type": "diabetic", "seed": 200},
    {"count": 2, "profile_type": "cardiac",  "seed": 300},
    {"count": 1, "profile_type": "mixed",    "seed": 400},
]

VITALS_PATTERN_MAP: dict[str, str] = {
    "target":   "deteriorating",
    "healthy":  "normal",
    "diabetic": "deteriorating",
    "cardiac":  "deteriorating",
    "mixed":    "normal",
}


def step(label: str):
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")


def post(path: str, json: dict | None = None) -> dict:
    url = f"{BASE_URL}{path}"
    resp = requests.post(url, json=json or {}, timeout=120)
    resp.raise_for_status()
    return resp.json()


def get(path: str) -> dict:
    url = f"{BASE_URL}{path}"
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


def main():
    t0 = time.time()

    # -- Pre-flight check --
    try:
        get("/synthetic/status")
    except requests.ConnectionError:
        print(f"ERROR: Cannot reach {BASE_URL}. Is the backend running?")
        print("Start it with:  cd backend && uvicorn main:app --reload")
        sys.exit(1)

    # -- 1. Generate patients --
    step("1/7  Generating synthetic patients")
    all_patient_ids: list[str] = []
    patient_profiles: dict[str, str] = {}

    for batch in PATIENT_BATCHES:
        resp = post("/synthetic/patients/generate", batch)
        ids = resp["patient_ids"]
        all_patient_ids.extend(ids)
        for pid in ids:
            patient_profiles[pid] = batch["profile_type"]
        print(f"  {batch['profile_type']:>10}: {resp['generated']} patients")

    print(f"  Total: {len(all_patient_ids)} patients")

    # -- 2. Generate vitals for each patient --
    step("2/7  Generating vitals histories (24h per patient)")
    for pid in all_patient_ids:
        profile = patient_profiles[pid]
        pattern = VITALS_PATTERN_MAP.get(profile, "normal")
        resp = post(f"/synthetic/vitals/{pid}/generate", {
            "pattern": pattern,
            "hours": 24,
            "interval_minutes": 5,
        })
        print(f"  {pid[:8]}… ({profile:>10}, {pattern:>13}): {resp['readings_written']} readings")

    # -- 3. Materialize all Patient 360 documents --
    step("3/7  Materializing Patient 360 documents")
    resp = post("/materializer/patients/materialize")
    print(f"  Materialized: {resp['materialized']}/{resp['total_patients']}")
    if resp.get("errors"):
        for err in resp["errors"]:
            print(f"  ERROR: {err}")

    # -- 4. Seed CDS rules --
    step("4/7  Seeding CDS rules")
    resp = post("/cds/rules/seed")
    print(f"  Seeded {resp['inserted']} rules: {', '.join(resp['rules'])}")

    # -- 5. Compute personalized thresholds --
    step("5/7  Computing personalized thresholds")
    for pid in all_patient_ids:
        thresholds = post(f"/cds/thresholds/{pid}")
        hr_high = thresholds.get("heart_rate", {}).get("high", "?")
        spo2_low = thresholds.get("spo2", {}).get("low", "?")
        adjustments = []
        if thresholds.get("heart_rate", {}).get("source_rule"):
            adjustments.append(f"HR≤{hr_high}")
        if thresholds.get("spo2", {}).get("source_rule"):
            adjustments.append(f"SpO2≥{spo2_low}")
        adj_str = f" (adjusted: {', '.join(adjustments)})" if adjustments else ""
        print(f"  {pid[:8]}…{adj_str}")

    # -- 6. Evaluate all patients against CDS rules --
    step("6/7  Evaluating CDS rules (generating alerts)")
    resp = post("/cds/evaluate")
    print(f"  Evaluated: {resp['evaluated']}/{resp['total_patients']}")
    print(f"  Alerts generated: {resp['total_alerts']}")
    if resp.get("errors"):
        for err in resp["errors"]:
            print(f"  ERROR: {err}")

    # -- 7. Compute HEDIS care gaps --
    step("7/7  Computing HEDIS care gaps")
    resp = post("/cds/care-gaps")
    print(f"  Processed: {resp['processed']}/{resp['total_patients']}")
    print(f"  Care gaps found: {resp['total_gaps_found']}")
    if resp.get("errors"):
        for err in resp["errors"]:
            print(f"  ERROR: {err}")

    # -- Summary --
    elapsed = time.time() - t0
    print(f"\n{'='*60}")
    print(f"  DEMO SETUP COMPLETE  ({elapsed:.1f}s)")
    print(f"{'='*60}")

    status = get("/synthetic/status")
    cds_status = get("/cds/status")
    print(f"  Patients:        {status['patients']}")
    print(f"  Vitals readings: {status['vitals_readings']}")
    print(f"  CDS rules:       {cds_status['cds_rules_count']}")
    print(f"  Active alerts:   {cds_status['alerts_count']}")
    print()
    print("  Frontend:  http://localhost:3000")
    print("  Compare:   http://localhost:3000/compare")
    print("  API docs:  http://localhost:8000/docs")


if __name__ == "__main__":
    main()
