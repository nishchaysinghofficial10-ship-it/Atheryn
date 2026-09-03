# ATHERYN v1.0 — Architecture

Use this as a map of the code, not a substitute for reading the boundary you plan to change.

Zero third-party dependencies. Python 3.10+. Every layer below exists in code;
absent capabilities are named in "Not built" at the end.

```
Interfaces
  atheryn/cli.py ............ init | run | status | report | timeline | html
                             verify | replay | ingest | cancel
  reports/mission_control.html  static generated dashboard (no server)

Autonomy layer (v1.5, optional)
  atheryn/autonomy.py ....... WorkItem + schema, MissionLease, AutonomyStore,
                             deterministic AutonomyPolicy, RunLimits,
                             retry classification and backoff
  atheryn/scheduler.py ...... one bounded restart-safe tick; bounded run loop
  autonomy/state.json ...... durable queue + counters (schema-versioned)
  autonomy/decisions.jsonl . append-only decision records
  autonomy/mission.lease ... single-writer lease (never auto-stolen)

Mission layer
  atheryn/state.py .......... ResearchState: durable snapshot + per-type views
  atheryn/lifecycle.py ...... validated state machine, migration, stop reasons
  atheryn/budget.py ......... experiments / compute / wall-time / provider / retries

Research orchestration
  atheryn/controller.py ..... next-action scoring, decision ledger, heartbeat,
                             stagnation guard, retry policy, terminal routing

Research reasoning
  atheryn/evidence.py ....... local document -> hashed source -> SPECULATION claims
  atheryn/graph.py .......... entities, relations, contradiction detection
  atheryn/models.py ......... Hypothesis/Prediction/Evidence/Claim/Source/
                             ExperimentRecord/FalsificationAttempt
  atheryn/critic.py ......... replication demand, falsification targeting,
                             scoped acceptance, assumption audit
  atheryn/brain.py .......... Brain ABC + NullBrain/MockBrain/AnthropicBrain
  atheryn/schema.py ......... internal JSON-schema subset validator

Execution
  atheryn/experiments.py .... policy gate -> confined subprocess -> artifacts
  atheryn/sandbox.py ........ rlimits, scrubbed env, output caps, design policy
  atheryn/domains/base.py ... domain plugin contract + registry
  atheryn/domains/algobench.py  flagship computational domain

Durability & governance
  logs/events.jsonl ........ append-only research timeline
  logs/brain.jsonl ......... provider call metadata (redacted)
  state.json (+ .bak) ...... atomic checkpoint with backup rotation
  research_state/*.json .... browsable per-type views
  experiments/exp_*/ ....... run.py + spec.json + result.json + stdout.log
  reports/ ................. dossier.md, timeline.md, mission_control.html
```

## Actual control flow (v1.0)

```
CREATED → VALIDATING → PLANNING → FORMING_HYPOTHESES
   (base hypotheses + schema-validated LLM proposals)
      ↓
SELECTING_NEXT_ACTION → DESIGNING_EXPERIMENT → EXECUTING → ANALYZING
      ↑                                                        ↓
      └──────────────── UPDATING_KNOWLEDGE ←──────────────────┘
      ↓ (no pending hypotheses, or budget exhausted)
CRITICIZING → REPLICATING (independent seeds)
           → FALSIFYING  (boundary size 2n + unseen regimes)
           → final review → dossier → COMPLETED (with stop reason)
```

Any non-terminal state may move to `PAUSED` (checkpointed, resumable) or
`CANCELLED`. Illegal transitions raise `IllegalTransition`; every transition is
logged as a `transition` event.

## Key design rules
- **The LLM proposes, ATHERYN decides.** Provider output passes JSON parse →
  schema → domain vocabulary (`build_check`) before becoming a PROPOSED
  hypothesis tagged `llm_proposed`. There is no code path from provider text to
  Evidence, FACT claims, or graph relations.
- **Evidence is generated, not asserted.** Every Evidence item cites the
  experiment that produced it; every status change appends to
  `confidence_history` and to the hypothesis's own `revisions`.
- **Confinement before execution.** `sandbox.validate_design` rejects unsafe
  designs before a process exists; the process itself runs under rlimits with a
  constructed environment.
- **Honest terminals.** Every terminal state records why it stopped.

## Autonomy control flow (v1.5)

```
load state → verify() → acquire lease → recover interrupted work
  → seed work items from mission state → policy selects ONE permitted action
  → dispatch to the EXISTING engine (all gates apply)
  → checkpoint result + decision + budget → release lease
```

The autonomy layer adds a chooser, not a capability. It never executes anything
itself: `run_experiment` goes through `ExperimentEngine` (and therefore
`sandbox.validate_design`), `retrieve_source` through `web_evidence.ingest_url`
(and therefore the full retrieval policy), `form_hypotheses` and `criticise`
through `ResearchController` steps.

## Not built in v1.0 (deliberate, see DECISIONS.md)
Live web acquisition; long-running daemon/scheduler; second research domain;
kernel-grade sandbox; graph visualisation; API server.
