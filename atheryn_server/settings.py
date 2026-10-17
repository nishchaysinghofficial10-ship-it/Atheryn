"""Server configuration, read once from the environment.

Every limit here exists because the server may be public: anyone who can
reach it can create and run missions unless ATHERYN_API_TOKEN is set. The
defaults keep a public instance cheap (fast profiles only, small budgets, one
mission executing at a time) without changing what a mission *means* — a
capped mission is still a complete ATHERYN mission with a recorded stop
reason.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# absolute(), not resolve(): following links can lengthen a path past the
# Windows MAX_PATH limit (e.g. packaged-app folder redirection) for no gain.
REPO_ROOT = Path(__file__).absolute().parent.parent

# Which CLI profiles fit which domain (the profile carries the regimes).
DOMAIN_PROFILES = {
    "algobench": ("fast", "standard", "flagship"),
    "graphbench": ("graph_fast", "graph_standard"),
}
DEFAULT_PROFILE = {"algobench": "fast", "graphbench": "graph_fast"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _env_list(name: str, default: tuple) -> tuple:
    raw = os.environ.get(name, "")
    if not raw.strip():
        return default
    return tuple(p.strip() for p in raw.split(",") if p.strip())


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    web_dir: Path = REPO_ROOT / "web"
    examples_dir: Path = REPO_ROOT / "examples"
    runs_dir: Path = REPO_ROOT / "runs" / "web"
    # When set, every state-changing endpoint requires
    # `Authorization: Bearer <token>`. Reads stay public.
    token: str = ""
    max_concurrent_runs: int = 1
    max_user_missions: int = 40
    max_experiments: int = 12
    max_compute_minutes: float = 5.0
    allowed_profiles: tuple = ("fast", "graph_fast")
    # Live LLM calls cost money and need ANTHROPIC_API_KEY; off unless asked.
    allow_provider: bool = False
    # Mission creation per client address, per window.
    create_limit: int = 6
    create_window_s: float = 600.0
    replay_limit: int = 10
    replay_window_s: float = 600.0
    # Trust X-Forwarded-For (only behind a proxy you control, e.g. Render).
    trust_proxy: bool = False
    cors_origins: tuple = field(default_factory=tuple)

    @classmethod
    def from_env(cls, **overrides) -> "Settings":
        values = dict(
            host=os.environ.get("HOST", "127.0.0.1"),
            port=_env_int("PORT", 8000),
            web_dir=Path(os.environ.get("ATHERYN_WEB_DIR", REPO_ROOT / "web")),
            examples_dir=Path(os.environ.get("ATHERYN_EXAMPLES_DIR",
                                             REPO_ROOT / "examples")),
            runs_dir=Path(os.environ.get("ATHERYN_RUNS_DIR",
                                         REPO_ROOT / "runs" / "web")),
            token=os.environ.get("ATHERYN_API_TOKEN", ""),
            max_concurrent_runs=max(1, _env_int("ATHERYN_MAX_CONCURRENT_RUNS", 1)),
            max_user_missions=max(1, _env_int("ATHERYN_MAX_USER_MISSIONS", 40)),
            max_experiments=max(1, _env_int("ATHERYN_MAX_EXPERIMENTS", 12)),
            max_compute_minutes=max(0.5, _env_float("ATHERYN_MAX_COMPUTE_MINUTES", 5.0)),
            allowed_profiles=_env_list("ATHERYN_ALLOWED_PROFILES",
                                       ("fast", "graph_fast")),
            allow_provider=_env_flag("ATHERYN_ALLOW_PROVIDER"),
            create_limit=max(1, _env_int("ATHERYN_CREATE_LIMIT", 6)),
            trust_proxy=_env_flag("ATHERYN_TRUST_PROXY"),
            cors_origins=_env_list("ATHERYN_CORS_ORIGINS", ()),
        )
        values.update(overrides)
        return cls(**values)

    def brains(self) -> tuple:
        out = ("mock", "none")
        if self.allow_provider and os.environ.get("ANTHROPIC_API_KEY"):
            out += ("anthropic",)
        return out
