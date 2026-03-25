"""
Wearable Patch Vitals Simulator.

Generates realistic time-series vitals data that mimics wearable patch output.  
Three simulation patterns are supported:

  normal        — physiologically plausible readings with natural circadian
                  rhythm and small random variation.

  deteriorating — a gradual multi-hour decline: rising HR & RR, falling SpO2
                  and activity, which the predictive model can detect early.

  acute         — rapid-onset deterioration representing an impending event
                  (sepsis, decompensated CHF, COPD exacerbation).

Medication & condition awareness
--------------------------------
If the patient's metadata indicates a beta-blocker is active (`has_beta_blocker`),
the simulated resting heart rate is shifted ~15 bpm lower, consistent with the
pharmacological effect.

CKD patients (`has_ckd`) receive a lower SpO2 baseline (~95.5 vs 97.5) to
reflect chronic hypoxemia, and during deteriorating/acute patterns their
respiratory rate is elevated +3–4 breaths/min (Kussmaul breathing from
metabolic acidosis).

Insulin-dependent patients (`has_insulin`) have a ~25 % chance of exhibiting
1–2 hypoglycemic dip windows during normal/deteriorating patterns: HR spikes
+20–30 bpm, activity drops sharply, slight temperature decrease.

Acute-pattern generation for CKD patients overlays a sepsis-specific
signature with faster temperature rise, more aggressive HR, and steeper
SpO2 decline.

Output format
-------------
Each reading is a plain dict ready for insertion into MongoDB's Time Series
collection:

  {
      "timestamp":        <ISO-8601 datetime string>,
      "patient_id":       <str>,
      "device_id":        <str>,
      "heart_rate":       <float>,   # bpm
      "respiratory_rate": <float>,   # breaths/min
      "temperature":      <float>,   # °C
      "spo2":             <float>,   # %
      "activity_level":   <float>,   # 0..10 arbitrary units
      "pattern":          <str>,     # for demo provenance
      "event":            <str|None> # "hypoglycemia", "sepsis", or None
  }
"""
from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np


# ---------------------------------------------------------------------------
# Physiological baseline constants
# ---------------------------------------------------------------------------

_BASELINES = {
    "heart_rate":       {"mean": 75.0,  "std": 5.0,  "min": 45.0,  "max": 130.0},
    "respiratory_rate": {"mean": 15.0,  "std": 1.5,  "min": 8.0,   "max": 35.0},
    "temperature":      {"mean": 37.0,  "std": 0.2,  "min": 35.5,  "max": 39.5},
    "spo2":             {"mean": 97.5,  "std": 0.8,  "min": 85.0,  "max": 100.0},
    "activity_level":   {"mean": 3.0,   "std": 1.5,  "min": 0.0,   "max": 10.0},
}

# Beta-blocker shifts nominal resting HR down
_BETA_BLOCKER_HR_SHIFT = -15.0  # bpm

# CKD patients: mild chronic hypoxemia → lower SpO2 baseline
_CKD_SPO2_SHIFT = -2.0  # %

# Metabolic acidosis (CKD + deterioration): compensatory Kussmaul breathing
_METABOLIC_ACIDOSIS_RR_SHIFT = 3.5  # breaths/min


# ---------------------------------------------------------------------------
# Deterioration profiles
# ---------------------------------------------------------------------------

# Each entry maps vital → (drift_per_hour, final_std_multiplier)
_DETERIORATING_DRIFT: dict[str, tuple[float, float]] = {
    "heart_rate":       (+2.5,  1.5),
    "respiratory_rate": (+0.8,  1.3),
    "temperature":      (+0.05, 1.1),
    "spo2":             (-0.4,  1.2),
    "activity_level":   (-0.5,  0.8),
}

_ACUTE_DRIFT: dict[str, tuple[float, float]] = {
    "heart_rate":       (+6.0,  2.5),
    "respiratory_rate": (+2.5,  2.0),
    "temperature":      (+0.12, 1.5),
    "spo2":             (-1.2,  2.0),
    "activity_level":   (-1.5,  0.5),
}

# Sepsis overlay (acute + CKD): faster temp rise, more aggressive HR/SpO2
_SEPSIS_DRIFT: dict[str, tuple[float, float]] = {
    "heart_rate":       (+8.0,  3.0),
    "respiratory_rate": (+3.0,  2.2),
    "temperature":      (+0.20, 1.8),
    "spo2":             (-1.8,  2.5),
    "activity_level":   (-1.5,  0.5),
}


# ---------------------------------------------------------------------------
# Simulator
# ---------------------------------------------------------------------------

class VitalsSimulator:
    """
    Generates a list of vitals readings for a given patient.

    Parameters
    ----------
    seed : int | None
        If provided, makes the simulation fully reproducible.
    """

    def __init__(self, seed: int | None = None):
        self.rng = random.Random(seed)
        self.np_rng = np.random.default_rng(seed)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def generate(
        self,
        patient_id: str,
        pattern: str = "normal",
        hours: int = 24,
        interval_minutes: int = 5,
        has_beta_blocker: bool = False,
        has_ckd: bool = False,
        has_insulin: bool = False,
    ) -> list[dict[str, Any]]:
        """
        Generate `hours` of vitals history ending at UTC now.

        Returns
        -------
        list[dict]
            One dict per reading, ordered oldest → newest.
        """
        n_readings = (hours * 60) // interval_minutes
        device_id  = f"PATCH-{self.rng.randint(10000, 99999)}"
        now        = datetime.now(timezone.utc)
        start_time = now - timedelta(hours=hours)

        timestamps = [
            start_time + timedelta(minutes=i * interval_minutes)
            for i in range(n_readings)
        ]

        is_sepsis = pattern == "acute" and has_ckd

        # Build per-vital time series
        series = self._build_series(
            pattern=pattern,
            n=n_readings,
            has_beta_blocker=has_beta_blocker,
            has_ckd=has_ckd,
        )

        # Per-reading event markers
        events: list[str | None] = ["sepsis"] * n_readings if is_sepsis else [None] * n_readings

        # Hypoglycemic episode injection (insulin patients, non-acute patterns)
        if has_insulin and pattern in ("normal", "deteriorating"):
            self._inject_hypoglycemic_episodes(series, events, n_readings, interval_minutes)

        readings: list[dict[str, Any]] = []
        for i, ts in enumerate(timestamps):
            readings.append(
                {
                    "timestamp":        ts,
                    "patient_id":       patient_id,
                    "device_id":        device_id,
                    "heart_rate":       round(float(series["heart_rate"][i]),       1),
                    "respiratory_rate": round(float(series["respiratory_rate"][i]), 1),
                    "temperature":      round(float(series["temperature"][i]),      2),
                    "spo2":             round(float(series["spo2"][i]),             1),
                    "activity_level":   round(float(series["activity_level"][i]),   2),
                    "pattern":          pattern,
                    "event":            events[i],
                }
            )
        return readings

    # ------------------------------------------------------------------
    # Incremental single-reading generation (for live SSE ticks)
    # ------------------------------------------------------------------

    def generate_next_reading(
        self,
        patient_id: str,
        last_reading: dict[str, Any],
        pattern: str = "normal",
        interval_seconds: int = 5,
        has_beta_blocker: bool = False,
        has_ckd: bool = False,
        has_insulin: bool = False,
    ) -> dict[str, Any]:
        """
        Generate ONE new vitals reading by advancing from ``last_reading``.

        Drift and noise are scaled to *interval_seconds* so that the rate
        of change matches the per-hour drift constants regardless of tick
        frequency.
        """
        is_sepsis = pattern == "acute" and has_ckd

        if is_sepsis:
            drift_map = _SEPSIS_DRIFT
        elif pattern == "deteriorating":
            drift_map = _DETERIORATING_DRIFT
        elif pattern == "acute":
            drift_map = _ACUTE_DRIFT
        else:
            drift_map = {k: (0.0, 1.0) for k in _BASELINES}

        hours_fraction = interval_seconds / 3600.0

        new: dict[str, Any] = {
            "timestamp":  datetime.now(timezone.utc),
            "patient_id": patient_id,
            "device_id":  last_reading.get("device_id", f"PATCH-{self.rng.randint(10000, 99999)}"),
            "pattern":    pattern,
            "event":      "sepsis" if is_sepsis else None,
        }

        for vital, params in _BASELINES.items():
            prev_val = float(last_reading.get(vital, params["mean"]))
            drift_per_hour, std_mult = drift_map.get(vital, (0.0, 1.0))

            drift = drift_per_hour * hours_fraction
            noise = float(self.np_rng.normal(0.0, params["std"] * std_mult * 0.3))

            raw = prev_val + drift + noise

            raw = max(params["min"], min(params["max"], raw))

            precision = 2 if vital == "temperature" else 1
            new[vital] = round(raw, precision)

        if has_insulin and pattern != "acute" and self.rng.random() < 0.02:
            new["heart_rate"] = min(
                round(new["heart_rate"] + self.rng.uniform(15.0, 25.0), 1),
                _BASELINES["heart_rate"]["max"],
            )
            new["activity_level"] = round(new["activity_level"] * 0.3, 2)
            new["event"] = "hypoglycemia"

        return new

    # ------------------------------------------------------------------
    # Series builders
    # ------------------------------------------------------------------

    def _build_series(
        self,
        pattern: str,
        n: int,
        has_beta_blocker: bool,
        has_ckd: bool = False,
    ) -> dict[str, np.ndarray]:
        """Return a dict of vital → numpy array of length n."""

        drift_map: dict[str, tuple[float, float]]
        if pattern == "acute" and has_ckd:
            # Sepsis overlay: enhanced acute drift
            drift_map = _SEPSIS_DRIFT
        elif pattern == "deteriorating":
            drift_map = _DETERIORATING_DRIFT
        elif pattern == "acute":
            drift_map = _ACUTE_DRIFT
        else:
            # Normal — zero drift, standard variation
            drift_map = {k: (0.0, 1.0) for k in _BASELINES}

        t = np.linspace(0, 1, n)  # normalised time axis [0, 1]
        series: dict[str, np.ndarray] = {}

        for vital, params in _BASELINES.items():
            mean = params["mean"]
            std  = params["std"]

            # Medication context adjustment
            if vital == "heart_rate" and has_beta_blocker:
                mean += _BETA_BLOCKER_HR_SHIFT

            # CKD: chronic hypoxemia → lower SpO2 baseline
            if vital == "spo2" and has_ckd:
                mean += _CKD_SPO2_SHIFT

            # Metabolic acidosis: CKD + deterioration → compensatory tachypnea
            if vital == "respiratory_rate" and has_ckd and pattern in ("deteriorating", "acute"):
                mean += _METABOLIC_ACIDOSIS_RR_SHIFT

            drift_per_unit, std_mult = drift_map.get(vital, (0.0, 1.0))

            # Trend component (linear drift over the full observation window)
            trend = drift_per_unit * t

            # Circadian rhythm (~24-hour sine wave; scaled to ±2 bpm for HR etc.)
            circadian_amp = std * 0.4
            circadian   = circadian_amp * np.sin(2 * np.pi * t + self.rng.uniform(0, 2 * np.pi))

            # Gaussian noise
            noise_std = std * std_mult
            noise     = self.np_rng.normal(0.0, noise_std, n)

            raw = mean + trend + circadian + noise

            # Clip to physiological limits
            raw = np.clip(raw, params["min"], params["max"])

            series[vital] = raw

        return series

    # ------------------------------------------------------------------
    # Hypoglycemic episode injection
    # ------------------------------------------------------------------

    def _inject_hypoglycemic_episodes(
        self,
        series: dict[str, np.ndarray],
        events: list[str | None],
        n: int,
        interval_minutes: int,
    ) -> None:
        """Randomly inject 1–2 hypoglycemic dip windows (~25 % chance)."""
        if self.rng.random() > 0.25:
            return

        n_episodes = self.rng.randint(1, 2)
        window_min = max(15 // interval_minutes, 1)
        window_max = max(30 // interval_minutes, window_min + 1)

        for _ in range(n_episodes):
            window_len = self.rng.randint(window_min, window_max)
            if n - window_len <= 0:
                continue
            start = self.rng.randint(0, n - window_len - 1)
            end   = start + window_len

            # HR spike +20–30 bpm
            series["heart_rate"][start:end] += self.np_rng.uniform(20.0, 30.0, window_len)
            # Activity drops sharply
            series["activity_level"][start:end] *= 0.2
            # Slight temperature drop
            series["temperature"][start:end] -= self.np_rng.uniform(0.2, 0.5, window_len)

            # Re-clip affected vitals
            for vital in ("heart_rate", "activity_level", "temperature"):
                params = _BASELINES[vital]
                series[vital][start:end] = np.clip(
                    series[vital][start:end], params["min"], params["max"],
                )

            for i in range(start, end):
                events[i] = "hypoglycemia"
