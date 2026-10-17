"""Mission discovery, JSON views of durable state, and the background runner.

Two kinds of mission are served:

  * **example** — the evidence shipped in `examples/`. Read-only: the server
    never runs, cancels, re-reports or otherwise writes to them.
  * **user** — missions created through the API under the runs directory.

One process, one writer per mission. A mission being executed is never
re-read from disk by request handlers; they get the snapshot the runner
published after its last checkpoint. That avoids reading `state.json` in the
instant `save()` rotates it, which `ResearchState.load` would (correctly)
treat as a crash and recover from the backup.
"""
from __future__ import annotations

import copy
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from atheryn import __version__
from atheryn import lifecycle as lc
from atheryn import sandbox, stats
from atheryn.brain import BrainConfigError, make_brain
from atheryn.budget import Budget
from atheryn.cli import PROFILES
from atheryn.controller import ResearchController
from atheryn.domains.base import get_domain
from atheryn.replay import ReplayPolicy, compare_results, render
from atheryn.report import render_dossier
from atheryn.state import CheckpointCorrupted, ResearchState

from .settings import DEFAULT_PROFILE, DOMAIN_PROFILES, Settings

ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,95}$")
EXP_RE = re.compile(r"^exp_[0-9a-f]{6,32}$")
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

# Row fields that are bulky and not needed by the site.
_ROW_DROP = {"samples", "input_digest", "output_digest"}
_CODE_CAP = 96_000
_LOG_CAP = 12_000


class ApiError(Exception):
    def __init__(self, status: int, message: str, **extra) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra


def can_execute() -> bool:
    """Experiments need POSIX rlimits + setsid (see atheryn/sandbox.py)."""
    return os.name == "posix" and sandbox.resource is not None


# discovery
@dataclass(frozen=True)
class MissionRef:
    id: str
    root: Path
    source: str                       # "example" | "user"

    @property
    def writable(self) -> bool:
        return self.source == "user"


def _has_state(path: Path) -> bool:
    return (path / "state.json").exists() or (path / "state.json.bak").exists()


class Registry:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.runs_dir = Path(settings.runs_dir)
        self._examples = self._scan_examples()

    def _scan_examples(self) -> dict[str, MissionRef]:
        found: dict[str, MissionRef] = {}
        base = Path(self.settings.examples_dir)
        if not base.is_dir():
            return found
        for top in sorted(p for p in base.iterdir() if p.is_dir()):
            candidates = [top] + sorted(p for p in top.iterdir() if p.is_dir())
            for path in candidates:
                if not _has_state(path):
                    continue
                rel = path.relative_to(base).parts
                mid = "--".join(rel).lower()
                if ID_RE.match(mid):
                    found[mid] = MissionRef(mid, path, "example")
        return found

    def examples(self) -> list[MissionRef]:
        return list(self._examples.values())

    def users(self) -> list[MissionRef]:
        if not self.runs_dir.is_dir():
            return []
        out = []
        for p in self.runs_dir.iterdir():
            if p.is_dir() and ID_RE.match(p.name) and _has_state(p):
                out.append(MissionRef(p.name, p, "user"))
        return out

    def get(self, mission_id: str) -> MissionRef:
        if not isinstance(mission_id, str) or not ID_RE.match(mission_id):
            raise ApiError(404, "no such mission")
        ref = self._examples.get(mission_id)
        if ref is not None:
            return ref
        path = self.runs_dir / mission_id
        if path.is_dir() and _has_state(path):
            return MissionRef(mission_id, path, "user")
        raise ApiError(404, "no such mission")

    def new_user_root(self) -> tuple[str, Path]:
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        for _ in range(8):
            mid = "m-" + uuid.uuid4().hex[:12]
            path = self.runs_dir / mid
            if not path.exists():
                return mid, path
        raise ApiError(500, "could not allocate a mission id")


# serialization
def _hypothesis(h) -> dict:
    return {
        "id": h.id, "statement": h.statement, "rationale": h.rationale,
        "status": h.status.value, "importance": h.importance,
        "cost_estimate": h.cost_estimate, "tags": list(h.tags),
        "scope": h.scope, "assumptions": list(h.assumptions),
        "tested_in": list(h.tested_in),
        "supporting": len(h.supporting_evidence),
        "contradicting": len(h.contradicting_evidence),
        "predictions": [{"id": p.id, "text": p.text, "check": p.check,
                         "outcome": p.outcome, "detail": p.detail}
                        for p in h.predictions],
        "revisions": list(h.revisions),
        "created_at": h.created_at, "updated_at": h.updated_at,
    }


def _experiment(rec) -> dict:
    d = rec.design or {}
    return {
        "id": rec.id, "title": rec.title, "status": rec.status,
        "hypothesis_ids": list(rec.hypothesis_ids),
        "duration_s": rec.duration_s, "summary": rec.summary,
        "error": rec.error[-400:] if rec.error else "",
        "created_at": rec.created_at, "finished_at": rec.finished_at,
        "design": {k: d.get(k) for k in ("kind", "round", "algorithms",
                                         "regimes", "sizes", "trials", "seed",
                                         "cutoffs", "probe_checks")
                   if k in d},
    }


def serialize_state(st: ResearchState, ref: MissionRef) -> dict:
    meta = st.meta
    graph = st.graph
    counts = st.counts()
    counts.update(falsifications=len(st.falsifications),
                  decisions=len(st.decisions),
                  invalidities=len(st.invalidities))
    budget = st.budget.to_dict()
    budget["fraction_used"] = round(st.budget.fraction_used(), 4)
    relations = []
    for rel in sorted(graph.relations.values(), key=lambda r: r.get("created_at", 0)):
        relations.append({"subject": graph.entity_name(rel["subj"]),
                          "predicate": rel["pred"],
                          "object": graph.entity_name(rel["obj"]),
                          "confidence": rel.get("confidence"),
                          "evidence": len(rel.get("evidence_ids", []))})
    return {
        "id": ref.id, "source": ref.source, "writable": ref.writable,
        "question": meta.get("question", ""),
        "domain": meta.get("domain", ""),
        "profile": meta.get("profile", ""),
        "brain": meta.get("brain", "none"),
        "phase": meta.get("phase", lc.CREATED),
        "terminal": meta.get("phase") in lc.TERMINAL,
        "stop_reason": meta.get("stop_reason", ""),
        "created_at": meta.get("created_at"),
        "ended_at": meta.get("ended_at"),
        "domain_config": meta.get("domain_config", {}),
        "step": st.step,
        "current": st.flags.get("current", ""),
        "counts": counts,
        "budget": budget,
        "hypotheses": [_hypothesis(h) for h in st.hypotheses.values()],
        "experiments": [_experiment(r) for r in
                        sorted(st.experiments.values(), key=lambda r: r.created_at)],
        "decisions": [{"id": d.get("id"), "step": d.get("step"),
                       "context": d.get("context"), "chosen": d.get("chosen"),
                       "reason": d.get("reason"), "ts": d.get("ts"),
                       "options": (d.get("options") or [])[:6]}
                      for d in st.decisions[-200:]],
        "falsifications": [{"id": f.id, "hypothesis_id": f.hypothesis_id,
                            "experiment_id": f.experiment_id, "probe": f.probe,
                            "outcome": f.outcome, "detail": f.detail, "ts": f.ts}
                           for f in st.falsifications.values()],
        "invalidities": [{"id": i.id, "candidate": i.candidate,
                          "condition": i.condition, "reason": i.reason,
                          "experiment_id": i.experiment_id}
                         for i in st.invalidities.values()],
        "claims": [{"id": c.id, "text": c.text, "status": c.status.value,
                    "confidence": c.confidence, "claim_type": c.claim_type}
                   for c in list(st.claims.values())[:100]],
        "contradictions": [{"id": c.get("id"), "description": c.get("description")}
                           for c in graph.contradictions],
        "relations": relations[:300],
        "assumptions": list(st.assumptions),
        "cautions": list(st.cautions),
        "recommendations": list(st.recommendations),
        "failures": list(st.failures[-100:]),
        "confidence_history": list(st.confidence_history[-200:]),
        "plan": st.plan,
    }


def summary_of(snapshot: dict) -> dict:
    keys = ("id", "source", "writable", "question", "domain", "profile",
            "phase", "terminal", "stop_reason", "created_at", "ended_at",
            "step", "counts", "budget", "run")
    out = {k: snapshot.get(k) for k in keys}
    hyps = snapshot.get("hypotheses", [])
    out["accepted"] = sum(1 for h in hyps if h["status"] == "accepted_with_scope")
    out["rejected"] = sum(1 for h in hyps if h["status"] == "rejected")
    return out


def read_events(root: Path, after: int = 0, limit: int = 500) -> dict:
    """Events after index `after`. A torn final line (a writer mid-append)
    is left for the next poll rather than skipped, so indices never shift."""
    path = root / "logs" / "events.jsonl"
    after = max(0, after)
    events, total = [], 0
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    lines = text.split("\n")
    for pos, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            if pos == len(lines) - 1:
                break          # torn tail: a writer is mid-append
            continue           # malformed historical line; verify() reports it
        if total >= after and len(events) < limit:
            events.append({"i": total, "ts": entry.get("ts"),
                           "kind": entry.get("kind", ""),
                           "msg": str(entry.get("msg", ""))[:2000],
                           "refs": entry.get("refs") or {}})
        total += 1
    nxt = events[-1]["i"] + 1 if events else min(after, total)
    return {"events": events, "total": total, "next": nxt}


def _clean_row(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in _ROW_DROP}


def experiment_results(st: ResearchState) -> list[dict]:
    out = []
    for rec in sorted(st.experiments.values(), key=lambda r: r.created_at):
        if rec.status != "completed":
            continue
        path = rec.path(st.root) / "result.json"
        if not path.exists():
            continue
        try:
            result = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        out.append({"experiment_id": rec.id, "title": rec.title,
                    "kind": (rec.design or {}).get("kind"),
                    "design": _experiment(rec)["design"],
                    "environment": result.get("environment", {}),
                    "code_digest": result.get("code_digest", ""),
                    "rows": [_clean_row(r) for r in result.get("rows", [])]})
    return out


def _read_text(path: Path, cap: int) -> str:
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return ""
    return text if len(text) <= cap else text[:cap] + "\n…[truncated]"


def experiment_detail(st: ResearchState, exp_id: str) -> dict:
    if not EXP_RE.match(exp_id or ""):
        raise ApiError(404, "no such experiment")
    rec = st.experiments.get(exp_id)
    if rec is None:
        raise ApiError(404, "no such experiment")
    d = rec.path(st.root)
    result = None
    if (d / "result.json").exists():
        try:
            raw = json.loads((d / "result.json").read_text())
            result = {k: v for k, v in raw.items() if k != "rows"}
            result["rows"] = [_clean_row(r) for r in raw.get("rows", [])]
        except (OSError, json.JSONDecodeError):
            result = None
    spec = None
    if (d / "spec.json").exists():
        try:
            spec = json.loads((d / "spec.json").read_text())
        except (OSError, json.JSONDecodeError):
            spec = None
    return {"record": _experiment(rec), "spec": spec, "result": result,
            "code": _read_text(d / "run.py", _CODE_CAP),
            "log": _read_text(d / "stdout.log", _LOG_CAP)}


# runner
@dataclass
class RunHandle:
    mission_id: str
    started_at: float = field(default_factory=time.time)
    status: str = "starting"          # starting|running|paused|finished|cancelled|error
    stop_request: str = ""            # "" | "pause" | "cancel"
    steps_done: int = 0
    error: str = ""
    finished_at: float = 0.0
    snapshot: dict | None = None
    dossier: str = ""
    thread: threading.Thread | None = None

    @property
    def alive(self) -> bool:
        return self.status in ("starting", "running")

    def public(self) -> dict:
        return {"running": self.alive, "status": self.status,
                "stop_request": self.stop_request,
                "steps_done": self.steps_done, "error": self.error,
                "started_at": self.started_at,
                "finished_at": self.finished_at or None}


class Runtime:
    """Owns every mutation of user missions in this process."""

    def __init__(self, settings: Settings, registry: Registry) -> None:
        self.settings = settings
        self.registry = registry
        self._lock = threading.Lock()
        self._runs: dict[str, RunHandle] = {}
        self._io: dict[str, threading.RLock] = {}
        self._replays = 0
        self._example_cache: dict[str, dict] = {}

    # locks
    def io_lock(self, mission_id: str) -> threading.RLock:
        with self._lock:
            return self._io.setdefault(mission_id, threading.RLock())

    def handle(self, mission_id: str) -> RunHandle | None:
        with self._lock:
            return self._runs.get(mission_id)

    def active_count(self) -> int:
        with self._lock:
            return sum(1 for h in self._runs.values() if h.alive) + self._replays

    def run_info(self, mission_id: str) -> dict:
        h = self.handle(mission_id)
        if h is None:
            return {"running": False, "status": "idle", "stop_request": "",
                    "steps_done": 0, "error": "", "started_at": None,
                    "finished_at": None}
        return h.public()

    # reads
    def load(self, ref: MissionRef) -> ResearchState:
        """Load from disk. Callers must not use this for a running mission."""
        with self.io_lock(ref.id):
            try:
                return ResearchState.load(ref.root)
            except CheckpointCorrupted as e:
                raise ApiError(500, f"checkpoint error: {e}")
            except FileNotFoundError:
                raise ApiError(404, "no such mission")

    def snapshot(self, ref: MissionRef) -> dict:
        h = self.handle(ref.id)
        if ref.source == "example":
            # Shipped evidence never changes while the server runs.
            cached = self._example_cache.get(ref.id)
            if cached is None:
                cached = serialize_state(self.load(ref), ref)
                self._example_cache[ref.id] = cached
            snap = dict(cached)
        elif h is not None and h.alive and h.snapshot is not None:
            snap = dict(h.snapshot)
        else:
            snap = serialize_state(self.load(ref), ref)
        snap["run"] = self.run_info(ref.id)
        return snap

    def dossier(self, ref: MissionRef) -> str:
        h = self.handle(ref.id)
        if h is not None and h.alive:
            return h.dossier
        st = self.load(ref)
        if ref.source == "example" or st.meta.get("phase") in lc.TERMINAL:
            stored = ref.root / "reports" / "dossier.md"
            if stored.exists():
                return stored.read_text(errors="replace")
        return render_dossier(st, get_domain(st.meta["domain"]))

    # create
    def create(self, payload: dict) -> MissionRef:
        s = self.settings
        if not isinstance(payload, dict):
            raise ApiError(400, "expected a JSON object")
        question = CONTROL_CHARS.sub(" ", str(payload.get("question", ""))).strip()
        question = re.sub(r"\s+", " ", question)
        if len(question) < 8:
            raise ApiError(400, "question must be at least 8 characters")
        if len(question) > 300:
            raise ApiError(400, "question must be at most 300 characters")
        domain = payload.get("domain", "algobench")
        if domain not in DOMAIN_PROFILES:
            raise ApiError(400, f"domain must be one of {sorted(DOMAIN_PROFILES)}")
        profile = payload.get("profile") or DEFAULT_PROFILE[domain]
        if profile not in DOMAIN_PROFILES[domain]:
            raise ApiError(400, f"profile {profile!r} does not fit domain {domain!r}")
        if profile not in s.allowed_profiles:
            raise ApiError(400, f"profile {profile!r} is not enabled on this server "
                                f"(allowed: {', '.join(s.allowed_profiles)})")
        try:
            max_exp = int(payload.get("max_experiments", min(10, s.max_experiments)))
            minutes = float(payload.get("compute_minutes", min(3.0, s.max_compute_minutes)))
        except (TypeError, ValueError):
            raise ApiError(400, "budgets must be numbers")
        if not 1 <= max_exp <= s.max_experiments:
            raise ApiError(400, f"max_experiments must be 1..{s.max_experiments}")
        if not 0.5 <= minutes <= s.max_compute_minutes:
            raise ApiError(400, f"compute_minutes must be 0.5..{s.max_compute_minutes:g}")
        brain = payload.get("brain", "mock")
        if brain not in s.brains():
            raise ApiError(400, f"brain must be one of {list(s.brains())}")

        with self._lock:
            if len(self.registry.users()) >= s.max_user_missions:
                raise ApiError(429, "this server holds its maximum number of "
                                    "missions; try again later")
            mid, root = self.registry.new_user_root()
            # Wall-time cap: generous next to compute, so the compute budget
            # is what normally ends a mission, but nothing runs unbounded.
            budget = Budget(experiments_total=max_exp,
                            compute_seconds_total=minutes * 60,
                            elapsed_seconds_total=max(180.0, minutes * 60 * 3),
                            provider_calls_total=20)
            st = ResearchState.create(root, question, domain,
                                      copy.deepcopy(PROFILES[profile]), budget,
                                      profile=profile)
            st.meta["brain"] = brain
            st.meta["created_via"] = "web"
            (root / "project.json").write_text(json.dumps(st.meta, indent=2))
            st.save()
        return MissionRef(mid, root, "user")

    # run
    def start(self, ref: MissionRef, max_steps: int | None = None) -> RunHandle:
        if not ref.writable:
            raise ApiError(403, "shipped example missions are read-only")
        if not can_execute():
            raise ApiError(503, "this server cannot execute experiments: ATHERYN "
                                "confines them with POSIX rlimits, so it must run "
                                "on Linux or macOS")
        with self._lock:
            current = self._runs.get(ref.id)
            if current is not None and current.alive:
                raise ApiError(409, "mission is already running")
            busy = sum(1 for h in self._runs.values() if h.alive) + self._replays
            if busy >= self.settings.max_concurrent_runs:
                raise ApiError(429, "the engine is busy with another mission; "
                                    "try again shortly")
            h = RunHandle(ref.id)
            self._runs[ref.id] = h
        # Validate before spawning so obvious refusals are synchronous.
        try:
            st = self.load(ref)
        except ApiError:
            with self._lock:
                self._runs.pop(ref.id, None)
            raise
        if st.meta.get("phase") in lc.TERMINAL:
            with self._lock:
                self._runs.pop(ref.id, None)
            raise ApiError(409, f"mission is terminal ({st.meta['phase']}): "
                                f"{st.meta.get('stop_reason', '')}")
        h.snapshot = serialize_state(st, ref)
        t = threading.Thread(target=self._work, args=(h, ref, st, max_steps),
                             name=f"atheryn-run-{ref.id}", daemon=True)
        h.thread = t
        t.start()
        return h

    def _publish(self, h: RunHandle, st: ResearchState, ref: MissionRef, domain) -> None:
        snap = serialize_state(st, ref)
        try:
            dossier = render_dossier(st, domain)
        except Exception:  # noqa: BLE001 - a live dossier is best-effort
            dossier = h.dossier
        with self._lock:
            h.snapshot = snap
            h.dossier = dossier

    def _save(self, ref: MissionRef, st: ResearchState) -> None:
        with self.io_lock(ref.id):
            st.save()

    def _work(self, h: RunHandle, ref: MissionRef, st: ResearchState,
              max_steps: int | None) -> None:
        domain = get_domain(st.meta["domain"])
        try:
            lc.resume(st)
            try:
                brain = make_brain(st.meta.get("brain", "mock"),
                                   logger=_brain_logger(ref.root), budget=st.budget)
            except BrainConfigError as e:
                raise RuntimeError(f"brain configuration error: {e}")
            ctl = ResearchController(st, domain, brain=brain)
            # Same reconciliation ResearchController.run() performs.
            adopted = st.reconcile_orphans()
            if adopted:
                st.cautions.append(
                    f"{len(adopted)} experiment(s) were interrupted before being "
                    f"checkpointed and are recorded as interrupted: "
                    f"{', '.join(adopted)}")
            st.log_event("web_run", "run started from the web console")
            self._save(ref, st)
            h.status = "running"
            self._publish(h, st, ref, domain)
            while True:
                if h.stop_request == "cancel":
                    lc.advance(st, lc.CANCELLED, "cancelled from the web console")
                    self._save(ref, st)
                    h.status = "cancelled"
                    break
                if h.stop_request == "pause":
                    lc.advance(st, lc.PAUSED, "paused from the web console")
                    self._save(ref, st)
                    h.status = "paused"
                    break
                if max_steps is not None and h.steps_done >= max_steps:
                    lc.advance(st, lc.PAUSED, f"paused after {h.steps_done} step(s)")
                    self._save(ref, st)
                    h.status = "paused"
                    break
                cont = ctl.step()
                st.step += 1
                h.steps_done += 1
                self._save(ref, st)      # checkpoint after every step
                self._publish(h, st, ref, domain)
                if not cont:
                    h.status = ("finished" if st.meta.get("phase") == lc.COMPLETED
                                else st.meta.get("phase", "finished").lower())
                    break
        except Exception as e:  # noqa: BLE001 - surface, never kill the server
            h.error = f"{type(e).__name__}: {e}"
            h.status = "error"
            traceback.print_exc(file=sys.stderr)
        finally:
            h.finished_at = time.time()
            try:
                self._publish(h, st, ref, domain)
            except Exception:  # noqa: BLE001
                pass

    def request_stop(self, ref: MissionRef, kind: str) -> dict:
        if not ref.writable:
            raise ApiError(403, "shipped example missions are read-only")
        h = self.handle(ref.id)
        if h is not None and h.alive:
            h.stop_request = kind
            return {"accepted": True, "deferred": True,
                    "detail": "takes effect at the next checkpoint"}
        with self.io_lock(ref.id):
            st = self.load(ref)
            phase = st.meta.get("phase")
            if phase in lc.TERMINAL:
                raise ApiError(409, f"mission is already terminal ({phase})")
            if kind == "pause":
                return {"accepted": True, "deferred": False,
                        "detail": "mission is not running; nothing to pause"}
            lc.advance(st, lc.CANCELLED, "cancelled from the web console")
            self._save(ref, st)
        return {"accepted": True, "deferred": False, "detail": "mission cancelled"}

    def verify(self, ref: MissionRef) -> dict:
        h = self.handle(ref.id)
        if h is not None and h.alive:
            raise ApiError(409, "verify after the run pauses or completes")
        problems = self.load(ref).verify()
        return {"ok": not problems, "problems": problems}

    # replay
    def replay(self, ref: MissionRef, exp_id: str) -> dict:
        """Re-execute a stored experiment in a temp dir and compare.

        Read-only for the mission: exactly what `atheryn replay` does."""
        if not can_execute():
            raise ApiError(503, "this server cannot execute experiments "
                                "(POSIX required)")
        h = self.handle(ref.id)
        if h is not None and h.alive:
            raise ApiError(409, "replay after the run pauses or completes")
        st = self.load(ref)
        if not EXP_RE.match(exp_id or "") or exp_id not in st.experiments:
            raise ApiError(404, "no such experiment")
        rec = st.experiments[exp_id]
        stored_dir = rec.path(st.root)
        for needed in ("result.json", "run.py", "spec.json"):
            if not (stored_dir / needed).exists():
                raise ApiError(409, f"{exp_id} is missing {needed}; it cannot be "
                                    f"reproduced from its record")
        timeout = min(float(rec.design.get("timeout_s", 600)),
                      sandbox.DEFAULT_POLICY["max_timeout_s"])
        with self._lock:
            busy = sum(1 for x in self._runs.values() if x.alive) + self._replays
            if busy >= self.settings.max_concurrent_runs:
                raise ApiError(429, "the engine is busy; try again shortly")
            self._replays += 1
        try:
            stored = json.loads((stored_dir / "result.json").read_text())
            with tempfile.TemporaryDirectory() as td:
                shutil.copy(stored_dir / "run.py", Path(td) / "run.py")
                shutil.copy(stored_dir / "spec.json", Path(td) / "spec.json")
                t0 = time.perf_counter()
                try:
                    proc = subprocess.run(
                        [sys.executable, "-I", "run.py"], cwd=td,
                        capture_output=True, text=True, timeout=timeout,
                        env=sandbox.scrubbed_env(td),
                        preexec_fn=sandbox.make_preexec(timeout))
                except subprocess.TimeoutExpired:
                    return {"ok": False, "experiment_id": exp_id,
                            "lines": [f"REPLAY FAIL — timed out after {timeout:.0f}s"]}
                dur = time.perf_counter() - t0
                fresh_path = Path(td) / "result.json"
                if proc.returncode != 0 or not fresh_path.exists():
                    return {"ok": False, "experiment_id": exp_id,
                            "lines": ["REPLAY FAIL — the stored experiment did not "
                                      f"re-execute cleanly (exit {proc.returncode})",
                                      sandbox.truncate_output(proc.stderr)[-800:]]}
                fresh = json.loads(fresh_path.read_text())
        finally:
            with self._lock:
                self._replays -= 1
        policy = ReplayPolicy()
        rep = compare_results(stored, fresh, policy)
        header = (f"Replayed {rec.id} in {dur:.1f}s from its recorded code and "
                  f"config (seed {rec.design.get('seed')}, "
                  f"{rec.design.get('trials')} trials/cell).")
        return {"ok": not rep.failed(policy), "experiment_id": exp_id,
                "duration_s": round(dur, 3), "env_matches": rep.env_matches,
                "hard_failures": len(rep.hard_failures),
                "timing_deviations": len(rep.timing),
                "inversions": len(rep.inversions),
                "lines": render(rep, policy, header)}

    def shutdown(self, wait_s: float = 20.0) -> None:
        """Ask every run to pause at its next checkpoint, then wait briefly."""
        with self._lock:
            handles = [h for h in self._runs.values() if h.alive]
        for h in handles:
            h.stop_request = "pause"
        deadline = time.time() + wait_s
        for h in handles:
            if h.thread is not None:
                h.thread.join(max(0.0, deadline - time.time()))


def _brain_logger(root: Path):
    def log(meta: dict) -> None:
        (root / "logs").mkdir(parents=True, exist_ok=True)
        with open(root / "logs" / "brain.jsonl", "a") as f:
            f.write(json.dumps(meta, default=str) + "\n")
    return log


# metadata
def domain_catalog() -> list[dict]:
    from atheryn.domains import algobench, graphbench
    return [
        {"name": "algobench",
         "title": "Sorting benchmarks",
         "question_shape": "which sorting strategy wins under which input regime",
         "candidates": sorted(algobench.ALGORITHMS),
         "base_roster": list(algobench.BASE_ROSTER),
         "regimes": sorted(algobench.GENERATORS),
         "probe_regimes": list(algobench.PROBE_REGIMES),
         "metrics": {"mean_s": "timing"},
         "profiles": list(DOMAIN_PROFILES["algobench"]),
         "example_question": "Which sorting strategy wins under which input regime?"},
        {"name": "graphbench",
         "title": "Shortest paths",
         "question_shape": "which shortest-path method wins on which graph topology",
         "candidates": sorted(graphbench.ALGORITHMS),
         "base_roster": list(graphbench.BASE_ROSTER),
         "conditional": list(graphbench.CONDITIONAL),
         "regimes": sorted(graphbench.GENERATORS),
         "probe_regimes": list(graphbench.PROBE_REGIMES),
         "metrics": {"mean_s": "timing", "relaxations": "exact"},
         "profiles": list(DOMAIN_PROFILES["graphbench"]),
         "example_question": "Which shortest-path method wins on which graph "
                             "topology, and where is BFS actually correct?"},
    ]


def meta_payload(settings: Settings) -> dict:
    return {
        "version": __version__,
        "can_execute": can_execute(),
        "platform": sys.platform,
        "python": sys.version.split()[0],
        "domains": domain_catalog(),
        "profiles": {name: PROFILES[name] for name in PROFILES},
        "lifecycle": [lc.CREATED, lc.VALIDATING, lc.PLANNING,
                      lc.FORMING_HYPOTHESES, lc.SELECTING_NEXT_ACTION,
                      lc.DESIGNING_EXPERIMENT, lc.EXECUTING, lc.ANALYZING,
                      lc.UPDATING_KNOWLEDGE, lc.CRITICIZING, lc.REPLICATING,
                      lc.FALSIFYING, lc.COMPLETED],
        "decisive_rule": {"min_trials": stats.MIN_TRIALS, "k_sem": stats.K_SEM,
                          "min_rel_margin": stats.MIN_REL_MARGIN},
        "limits": {"max_experiments": settings.max_experiments,
                   "max_compute_minutes": settings.max_compute_minutes,
                   "allowed_profiles": list(settings.allowed_profiles),
                   "max_concurrent_runs": settings.max_concurrent_runs,
                   "brains": list(settings.brains())},
        "write_requires_token": bool(settings.token),
    }


def evaluation_payload(settings: Settings) -> dict:
    base = Path(settings.examples_dir) / "final_flagship_mission"
    out = {}
    for key, name in (("results", "EVALUATION_RESULTS.json"),
                      ("preregistration", "PREREGISTRATION.json")):
        p = base / name
        if p.exists():
            try:
                out[key] = json.loads(p.read_text())
            except (OSError, json.JSONDecodeError):
                out[key] = None
    if not out:
        raise ApiError(404, "flagship evaluation is not shipped with this build")
    return out
