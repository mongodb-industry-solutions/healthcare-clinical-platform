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

Medication awareness
--------------------
If the patient's metadata indicates a beta-blocker is active (`has_beta_blocker`),
the simulated resting heart rate is shifted ~15 bpm lower, consistent with the
pharmacological effect. This allows the dashboard to flag when the HR is
unexpectedly high *given* the medication context.

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

        # Build per-vital time series
        series = self._build_series(
            pattern=pattern,
            n=n_readings,
            has_beta_blocker=has_beta_blocker,
        )

        readings: list[dict[str, Any]] = []
        for i, ts in enumerate(timestamps):
            readings.append(
                {
                    "timestamp":        ts.isoformat(),
                    "patient_id":       patient_id,
                    "device_id":        device_id,
                    "heart_rate":       round(float(series["heart_rate"][i]),       1),
                    "respiratory_rate": round(float(series["respiratory_rate"][i]), 1),
                    "temperature":      round(float(series["temperature"][i]),      2),
                    "spo2":             round(float(series["spo2"][i]),             1),
                    "activity_level":   round(float(series["activity_level"][i]),   2),
                    "pattern":          pattern,
                }
            )
        return readings

    # ------------------------------------------------------------------
    # Series builders
    # ------------------------------------------------------------------

    def _build_series(
        self,
        pattern: str,
        n: int,
        has_beta_blocker: bool,
    ) -> dict[str, np.ndarray]:
        """Return a dict of vital → numpy array of length n."""

        drift_map: dict[str, tuple[float, float]]
        if pattern == "deteriorating":
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
