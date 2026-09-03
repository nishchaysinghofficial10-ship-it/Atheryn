"""Budget counters and admission checks for a research run.

ATHERYN operates under finite resources. Every investigation must justify its
cost, which turns the system into an active research agent rather than an
endless browser.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass
class Budget:
    experiments_total: int = 12
    experiments_used: int = 0
    compute_seconds_total: float = 1800.0
    compute_seconds_used: float = 0.0
    searches_total: int = 0        # kept for the deferred live-acquisition path
    searches_used: int = 0
    elapsed_seconds_total: float = 0.0   # zero means no mission wall-time cap
    elapsed_seconds_used: float = 0.0
    provider_calls_total: int = 0        # zero also covers a disabled or unlimited mock brain
    provider_calls_used: int = 0
    retries_total: int = 8               # shared retry cap for failed executions
    retries_used: int = 0

    def can_run_experiment(self, est_seconds: float = 0.0) -> bool:
        if self.experiments_used >= self.experiments_total:
            return False
        return (self.compute_seconds_used + est_seconds) <= self.compute_seconds_total

    def charge_experiment(self, seconds: float) -> None:
        self.experiments_used += 1
        self.compute_seconds_used += seconds

    def can_call_provider(self) -> bool:
        if self.provider_calls_total <= 0:
            return True
        return self.provider_calls_used < self.provider_calls_total

    def charge_provider_call(self) -> None:
        self.provider_calls_used += 1

    def can_retry(self) -> bool:
        return self.retries_used < self.retries_total

    def charge_retry(self) -> None:
        self.retries_used += 1

    def charge_elapsed(self, seconds: float) -> None:
        self.elapsed_seconds_used += seconds

    def exhausted_reason(self) -> str | None:
        """First exhausted dimension, or None if work may continue."""
        if self.experiments_used >= self.experiments_total:
            return f"experiment budget exhausted ({self.experiments_used}/{self.experiments_total})"
        if self.compute_seconds_used >= self.compute_seconds_total:
            return (f"compute budget exhausted "
                    f"({self.compute_seconds_used:.1f}/{self.compute_seconds_total:.0f}s)")
        if 0 < self.elapsed_seconds_total <= self.elapsed_seconds_used:
            return (f"mission wall-time budget exhausted "
                    f"({self.elapsed_seconds_used:.0f}/{self.elapsed_seconds_total:.0f}s)")
        return None

    def remaining(self) -> dict:
        provider_calls = "unlimited"
        if self.provider_calls_total:
            provider_calls = self.provider_calls_total - self.provider_calls_used

        return {
            "experiments": self.experiments_total - self.experiments_used,
            "compute_seconds": round(self.compute_seconds_total - self.compute_seconds_used, 1),
            "searches": self.searches_total - self.searches_used,
            "provider_calls": provider_calls,
            "retries": self.retries_total - self.retries_used,
        }

    def fraction_used(self) -> float:
        parts = []
        if self.experiments_total:
            parts.append(self.experiments_used / self.experiments_total)
        if self.compute_seconds_total:
            parts.append(self.compute_seconds_used / self.compute_seconds_total)
        return max(parts) if parts else 0.0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "Budget":
        known_fields = set(cls.__dataclass_fields__)
        values = {key: value for key, value in data.items() if key in known_fields}
        return cls(**values)
