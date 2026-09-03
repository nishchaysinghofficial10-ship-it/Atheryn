
<div align="center">
  <h1>ATHERYN</h1>
  <p><strong>Persistent computational research where every conclusion must earn its evidence.</strong></p>
  <p>
    A reproducible, evidence-first engine for turning questions into competing
    hypotheses, controlled experiments, independent replications,
    falsification probes, and explicitly scoped conclusions.
  </p>
  <p>
    <a href="#why-atheryn">Why ATHERYN?</a> ·
    <a href="#how-it-works">How it works</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#command-line-interface">CLI</a> ·
    <a href="#documentation">Documentation</a>
  </p>
</div>

---

## Overview

ATHERYN is an open-source **persistent computational research engine**. Give it
a research question in a supported domain and a resource budget, and it creates
an investigation that can be paused, resumed, inspected, verified, and replayed.

Instead of producing a single plausible answer, ATHERYN maintains competing
hypotheses and converts them into machine-checkable predictions. It selects
high-value experiments, executes them in policy-restricted subprocesses,
analyses the resulting measurements, and challenges promising findings through
independent replication and deliberate falsification.

Every conclusion is connected to the experiment that produced its evidence.
Every experiment preserves its code, configuration, inputs, seeds, outputs,
logs, environment metadata, and analysis. Every decision, contradiction,
failure, confidence change, and stopping reason becomes part of the durable
research record.

> **The central rule:** generation may propose an idea, but only evidence can
> promote it.

| Project | Current status |
|---|---|
| Version | `2.1.0` |
| Runtime | Python `3.10+` |
| Runtime dependencies | None — Python standard library only |
| Test suite | 268 tests |
| Included domains | Sorting benchmarks and graph shortest paths |
| Interface | Command-line application and generated static reports |
| License | MIT |

## Why ATHERYN?

Many AI systems generate an answer first and construct an explanation second.
That approach is useful for ideation, but it is not a reliable foundation for
experimental research. Fluent text cannot establish that a result is correct,
reproducible, statistically meaningful, or valid outside the conditions in
which it was observed.

ATHERYN treats research as an evolving evidence lifecycle:

- Generated ideas begin as **proposals**, never as facts.
- Multiple hypotheses remain in competition until experiments distinguish them.
- Predictions are encoded as executable checks instead of judged from prose.
- Weak or noisy measurements remain **inconclusive**.
- Promising findings must survive fresh-seed replication.
- Replicated findings are tested at boundaries and on unseen regimes.
- Accepted conclusions carry explicit scope and known limitations.
- Incorrect candidates are recorded as invalid under the conditions that exposed them.
- Failures and contradictions are preserved instead of edited out of the story.
- Every mission stops with a durable, explicit reason.

The result is not merely an answer. It is a portable, auditable record of what
was proposed, what was tested, what failed, what survived criticism, and why the
final conclusions deserve their current level of confidence.

## Flagship evaluation

ATHERYN ships with a pre-registered evaluation that investigates one
shortest-path question through three workflows:

1. Run a conventional benchmark and report the fastest implementation.
2. Ask a proposal system for conclusions without running experiments.
3. Run the complete ATHERYN research loop.

| Evaluation result | Benchmark | Proposal only | ATHERYN |
|---|---:|---:|---:|
| Experiments | 1 | 0 | 6 |
| Conclusions produced | 4 | 2 | 2 |
| Independent replications | 0 | 0 | **3** |
| Falsification probes | 0 | 0 | **2** |
| Explicitly scoped conclusions | 0 | 0 | **2** |
| Self-corrections | 0 | 0 | **2** |
| Incorrect candidate named a winner | **3** | 0 | **0** |

The ordinary benchmark reported `bfs_unit` as the fastest candidate on three
weighted graph topologies. The measurements were real: it was fast. The answer
was still invalid because that implementation returned incorrect distances
whenever the unit-weight precondition did not hold.

ATHERYN spent six experiments instead of one and produced fewer conclusions. It
identified the correctness boundary, independently replicated supported
results, attacked them on held-out graph topologies, rejected two
textbook-plausible hypotheses using its own evidence, and named no invalid
candidate as a winner.

That trade—**more investigation, fewer claims, and stronger evidence behind
each surviving conclusion**—is the reason ATHERYN exists.

The pre-registration, artifacts, and complete analysis are available in
[`examples/final_flagship_mission/`](examples/final_flagship_mission/) and
[`docs/reports/FLAGSHIP_EVALUATION.md`](docs/reports/FLAGSHIP_EVALUATION.md).

## How it works

```text
Research question + domain + budgets
                 │
                 ▼
        Plan and decompose the question
                 │
                 ▼
       Form competing hypotheses
                 │
                 ▼
    Create machine-checkable predictions
                 │
                 ▼
 Select the highest-value permitted action
                 │
                 ▼
 Design → validate → execute → analyse
                 │
                 ▼
 Update evidence, confidence, and graph state
                 │
                 ▼
   Replicate supported findings independently
                 │
                 ▼
  Attempt falsification at boundaries and on
             unseen conditions
                 │
                 ▼
 Produce scoped conclusions, cautions, gaps,
      recommendations, and a stop reason
```

The controller checkpoints the mission after every step. An interrupted run can
resume from durable state, and a completed mission can be verified or replayed
without relying on the original process.

## Core capabilities

### Persistent research state

- Atomic snapshot writes with backup rotation.
- Append-only event, decision, autonomy, and provider metadata logs.
- Schema-versioned state with migration and structural validation.
- Checkpoints after every controller step.
- Safe pause, resume, cancellation, and bounded continuation.
- Detection and reconciliation of orphaned experiment artifacts.
- Portable relative artifact paths for copied and archived missions.

### Evidence-centered reasoning

ATHERYN separates claims by epistemic status so uncertainty remains visible:

| Status | Meaning |
|---|---|
| `SPECULATION` | Untrusted or insufficiently supported material |
| `HYPOTHESIS` | A proposed explanation awaiting experimental evaluation |
| `EXPERIMENTAL_RESULT` | A result produced by a recorded experiment |
| `FACT` | Seeded prior knowledge from an explicitly trusted source |
| `CONTRADICTED` | A claim with significant evidence against it |

Hypotheses follow a separate lifecycle:

```text
PROPOSED
   └──▶ UNDER_TEST
          ├──▶ REJECTED
          ├──▶ WEAKENED
          └──▶ PROVISIONALLY_SUPPORTED
                      └──▶ independent replication
                              └──▶ falsification probe
                                      └──▶ ACCEPTED_WITH_SCOPE
```

Promotion to `ACCEPTED_WITH_SCOPE` requires confirmed predictions, an
independent replication, and a survived falsification probe. Every transition
adds a revision with its reason and updates the confidence history.

### Reproducible experimentation

Each experiment receives a permanent artifact directory:

```text
experiments/exp_<id>/
├── run.py          # exact self-contained program that was executed
├── spec.json       # design, inputs, regimes, trials, seed, and timeout
├── result.json     # structured measurements and prediction inputs
└── stdout.log      # bounded process output
```

ATHERYN distinguishes three reproducibility claims:

| Level | Meaning |
|---|---|
| **Exact reproducibility** | Code, configuration, inputs, correctness, and outputs match by digest |
| **Statistical reproducibility** | A performance relationship survives conservative comparison |
| **Absolute timing** | A host-specific observation that is reported but never claimed as portable |

The `replay` command re-executes stored code and compares fresh results with
the recorded artifacts. Strict timing comparison is available only when the
environment supports a meaningful comparison.

### Conservative statistical analysis

A timing relationship is decisive only when all of the following hold:

- Each side contains at least five trials.
- Separation exceeds three times the combined standard error.
- The relative performance margin is at least 10%.

Anything weaker is reported as `inconclusive`, not converted into support or
refutation. Exact metrics—such as edge-relaxation counts—are compared directly
and can report ties without passing through timing-noise rules.

### Independent replication and falsification

A hypothesis supported by its first experiment is not immediately accepted.
The critic requests an independent replication with new seeds and regenerated
inputs. A failed replication marks the prediction as unstable and downgrades
the hypothesis.

Replicated hypotheses then face deliberate attempts to break them:

- **Boundary probes** test larger sizes than the original experiment.
- **Scope probes** test regimes or topologies not used previously.
- Failed probes weaken or reject the hypothesis.
- Survived probes produce an explicit statement of where the conclusion held,
  failed, or remains untested.

### Knowledge graph and invalidity tracking

Research state maintains entities, relations, provenance, confidence, and
contradictions as a structured graph. Functional conflicts become research
targets instead of silently overwriting earlier results.

Invalidity is also a core concept. When an implementation is found to be wrong
under a condition, ATHERYN records that boundary and excludes the candidate
from winner selection for that condition.

### Bounded autonomy

ATHERYN can continue a mission across finite runs and process restarts.
Autonomy means selecting among already-permitted actions—not inventing new
capabilities or bypassing policy.

The autonomy layer provides:

- Durable, schema-validated work items.
- A deterministic policy that records every candidate and selection reason.
- One restart-safe action per scheduler tick.
- Explicit limits for steps, wall time, retrievals, provider calls, and failures.
- Typed retry classification with capped exponential backoff.
- An atomic single-writer mission lease that is never stolen automatically.
- Conservative recovery of interrupted work for operator review.
- Durable pause, resume, cancellation, and lock recovery.

There is no daemon or background service. Every autonomous run is finite and
bounded by user-supplied limits.

### Controlled LLM integration

The optional proposal layer supports deterministic mock proposals and an
Anthropic-backed provider. A model may suggest hypotheses, decompositions,
criticism targets, or experiment candidates, but its output never becomes an
accepted finding directly.

```text
JSON parsing → schema validation → domain vocabulary validation
             → policy review → proposal audit → experimental pipeline
```

Rejected proposals are retained with reasons. Provider metadata is redacted
before logging, credentials remain in environment variables, and
model-generated code is never executed.

### Policy-restricted evidence acquisition

ATHERYN can ingest local documents and explicitly approved HTTPS URLs as
untrusted evidence. It does not perform open-ended web search or crawling.

The retrieval stack includes:

- HTTPS-only URL policy.
- Rejection of loopback, private, link-local, and metadata-service addresses.
- DNS resolution, address pinning, and redirect revalidation.
- Host allow-lists, request budgets, and streaming byte limits.
- Content-type allow-lists and bounded decompression.
- Robots policy handling.
- Canonical URLs, content hashes, cached text, and passage provenance.
- Reliability scores accompanied by human-readable reasons.

Claims extracted from retrieved content remain `SPECULATION`. Retrieved pages
cannot create facts, experimental evidence, graph relations, or executable
code.

### Research reporting

Each mission can generate:

- A detailed Markdown research dossier.
- A chronological, replayable event timeline.
- A static HTML mission-control dashboard.
- Hypothesis and prediction ledgers.
- Experiment summaries and result tables.
- Contradiction and invalidity records.
- Failure and confidence-change histories.
- Assumption audits, cautions, knowledge gaps, and recommended investigations.
- A reproducibility appendix and explicit terminal reason.

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Interfaces                                                           │
│ CLI · status · reports · timeline · HTML · verify · replay · ingest │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ Bounded autonomy                                                    │
│ Work queue · deterministic policy · scheduler · lease · recovery    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ Research orchestration                                              │
│ Lifecycle · controller · budgets · critic · action scoring          │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
          ┌─────────────────────┴─────────────────────┐
          │                                           │
┌─────────▼────────────────────────┐      ┌───────────▼────────────────┐
│ Research reasoning              │      │ Experiment execution       │
│ Hypotheses · evidence · graph   │      │ Policy gate · subprocess   │
│ proposals · invalidity · stats  │      │ rlimits · artifacts        │
└─────────┬────────────────────────┘      └───────────┬────────────────┘
          │                                           │
          └─────────────────────┬─────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ Domain plugins                                                      │
│ algobench · graphbench · ResearchDomain contract                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│ Durable artifacts                                                   │
│ state · per-type views · event logs · experiments · reports         │
└──────────────────────────────────────────────────────────────────────┘
```

The orchestration core is domain-independent. A research domain implements a
small contract for decomposition, hypothesis generation, experiment design,
runner generation, analysis, replication, cost estimation, and gap detection.
The core owns lifecycle validation, budgets, persistence, evidence, criticism,
and reporting.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module-level map.

## Supported domains

### `algobench`

Investigates which sorting strategy performs best under different input
distributions and sizes. It evaluates a roster of algorithms, reasons about
performance regimes, and can generate additional candidates that pass through
the same testing and criticism pipeline.

Primary metric: host-specific wall-clock time.

### `graphbench`

Investigates single-source shortest-path methods across graph topologies and
weight regimes. It evaluates correctness as well as performance and exposes
conditions under which apparently fast candidates become invalid.

Primary metrics:

- Wall-clock time, treated as host-specific.
- Edge-relaxation counts, treated as exact and machine-independent.

Adding the second domain demonstrated that the architecture generalizes beyond
sorting and exposed two assumptions later promoted into the core: metric kinds
and candidate invalidity. See [`docs/SECOND_DOMAIN.md`](docs/SECOND_DOMAIN.md).

## Requirements

- Python 3.10 or newer.
- A POSIX environment with resource-limit support.
- No third-party runtime packages.

The declared release matrix covers CPython 3.10–3.14 on Linux x86-64. Windows
is unsupported because the experiment boundary depends on POSIX resource
limits.

## Quick start

From the repository root:

```bash
# Run the complete test suite without installing the package.
python3 -m unittest discover -s tests

# Create a small sorting research mission.
python3 -m atheryn init \
  "Which sorting strategy wins under which input regime?" \
  --dir runs/demo \
  --domain algobench \
  --profile fast

# Run the mission to completion.
python3 -m atheryn run --dir runs/demo

# Inspect, verify, and render the result.
python3 -m atheryn status --dir runs/demo
python3 -m atheryn verify --dir runs/demo
python3 -m atheryn report --dir runs/demo
python3 -m atheryn html --dir runs/demo
```

The generated research artifacts are stored inside `runs/demo/`.

### Run the graph domain

```bash
python3 -m atheryn init \
  "Which shortest-path method wins on which graph topology?" \
  --dir runs/graph \
  --domain graphbench \
  --profile graph_fast

python3 -m atheryn run --dir runs/graph
python3 -m atheryn report --dir runs/graph
```

### Run only a limited number of steps

```bash
python3 -m atheryn run --dir runs/demo --steps 3
python3 -m atheryn status --dir runs/demo
python3 -m atheryn run --dir runs/demo
```

The first run checkpoints and pauses after three steps. The second resumes from
persisted state.

## Command-line interface

| Command | Purpose |
|---|---|
| `init` | Create a mission with a question, domain, profile, budgets, and proposal provider |
| `run` | Run or resume the core research controller |
| `status` | Show mission phase, counts, budgets, and current investigation |
| `report` | Regenerate the Markdown research dossier |
| `timeline` | Print the replayable research event timeline |
| `html` | Generate the static mission-control dashboard |
| `verify` | Cross-check durable state, references, artifacts, and event logs |
| `replay` | Re-execute a stored experiment and compare fresh results |
| `ingest` | Ingest a local document or explicitly approved HTTPS URL |
| `autonomy` | Plan or perform bounded, restart-safe autonomous work |
| `cancel` | End a mission with a durable terminal record |

Run `python3 -m atheryn <command> --help` for command-specific options.

### Configure budgets and proposal providers

```bash
python3 -m atheryn init \
  "Which sorting strategy wins under which input regime?" \
  --dir runs/custom \
  --domain algobench \
  --max-experiments 24 \
  --compute-minutes 15 \
  --max-minutes 30 \
  --provider-calls 4 \
  --brain mock
```

Available proposal providers:

- `mock` — deterministic proposals for reproducible local runs; the default.
- `anthropic` — live provider integration with explicit credentials.
- `none` — deterministic domain logic without model proposals.

### Bounded autonomous operation

```bash
# Preview the next decision without executing it.
python3 -m atheryn autonomy plan --dir runs/demo

# Execute at most one permitted action.
python3 -m atheryn autonomy tick --dir runs/demo

# Continue within explicit limits.
python3 -m atheryn autonomy run \
  --dir runs/demo \
  --max-steps 10 \
  --max-wall-s 300 \
  --max-retrievals 2 \
  --max-provider-calls 2 \
  --max-consecutive-failures 2

# Inspect the queue, lease, budgets, and stop reason.
python3 -m atheryn autonomy status --dir runs/demo
```

Network retrieval and provider calls remain disabled unless an individual run
includes `--allow-network` or `--allow-provider`.

### Ingest evidence

```bash
# Ingest a local text document as untrusted evidence.
python3 -m atheryn ingest --dir runs/demo --file notes.txt

# Retrieve only from an explicitly approved HTTPS host.
python3 -m atheryn ingest \
  --dir runs/demo \
  --url https://example.org/reference \
  --provider https \
  --allow-host example.org \
  --max-requests 2 \
  --max-bytes 500000
```

### Replay an experiment

```bash
python3 -m atheryn replay \
  --dir runs/demo \
  --exp <experiment_id>
```

Use `--strict` only when timing comparisons are meaningful on the current
hardware and environment.

## Mission artifact layout

```text
runs/demo/
├── project.json                 # immutable mission metadata
├── state.json                   # complete atomic snapshot
├── state.json.bak               # previous valid checkpoint
├── research_state/
│   ├── hypotheses.json
│   ├── experiments.json
│   ├── evidence.json
│   ├── claims.json
│   ├── decisions.json
│   ├── failure_log.json
│   └── graph.json
├── experiments/
│   └── exp_<id>/
│       ├── run.py
│       ├── spec.json
│       ├── result.json
│       └── stdout.log
├── logs/
│   ├── events.jsonl
│   ├── proposals.jsonl
│   └── brain.jsonl
├── autonomy/
│   ├── state.json
│   ├── decisions.jsonl
│   └── mission.lease
├── sources/                     # cached documents and provenance
└── reports/
    ├── dossier.md
    ├── timeline.md
    └── mission_control.html
```

Every artifact is inspectable with ordinary text-processing tools. There is no
database or proprietary storage layer.

## Reproduce the shipped evidence

```bash
# Re-run the pre-registered three-workflow evaluation.
python3 tools/flagship_evaluation.py --dir runs/flagship-evaluation

# Demonstrate bounded autonomy.
python3 tools/autonomy_demo.py --dir runs/autonomy-demo

# Demonstrate deterministic evidence acquisition without network access.
python3 tools/web_evidence_demo.py --dir runs/evidence-demo --mode fixture

# Verify shipped missions in place.
python3 -m atheryn verify --dir examples/flagship_run
python3 -m atheryn verify \
  --dir examples/final_flagship_mission/atheryn_full
```

The repository includes replayable missions for sorting, graph shortest paths,
bounded autonomy, evidence ingestion, and the flagship comparison.

## Safety model

ATHERYN is designed to make trust boundaries explicit.

### Experiment execution

Experiment designs are checked against policy before a subprocess exists.
Permitted experiments run with:

- CPU, memory, file-size, and process-count resource limits.
- A wall-clock timeout.
- Isolated Python mode.
- A constructed, credential-free environment.
- A restricted working directory.
- Bounded output capture.
- Code generated only from audited domain templates.

This is **user-space confinement**, not kernel-grade isolation. Experiment
processes still run as the current operating-system user, and the project does
not claim filesystem or network namespacing.

### Untrusted inputs

- LLM responses are untrusted proposals.
- Retrieved pages and local documents are untrusted source material.
- Autonomy work items are schema-validated before dispatch.
- Credentials remain in environment variables and are removed from experiment
  environments.
- Logged strings pass through credential redaction.
- No provider response or retrieved text can become executable code.

Read [`docs/SECURITY.md`](docs/SECURITY.md) and the threat-model work in
[`docs/security/`](docs/security/) before using ATHERYN with sensitive data.

## What ATHERYN is not

- **Not a general autonomous scientist.** It performs computational experiments
  inside registered domains.
- **Not a web-search agent.** It retrieves URLs the user explicitly approves;
  it does not discover, search, or crawl the open web.
- **Not an unrestricted code-execution agent.** Only audited domain templates
  produce experiment runners.
- **Not an oracle.** Generated prose cannot promote itself into evidence.
- **Not a background service.** Bounded autonomy runs in finite, explicit
  sessions and does not install a daemon.
- **Not a distributed system.** There is no multi-agent coordination or remote
  experiment execution.
- **Not suitable for high-stakes wet-lab, medical, legal, or financial claims.**
  The included domains are deterministic computational benchmarks.

## Known limitations

- Only two research domains are currently included.
- Timing measurements are host-specific; only sufficiently strong within-run
  relationships are interpreted.
- Experiment confinement uses user-space controls rather than containers or
  kernel-level sandboxing.
- The live Anthropic network call remains unverified in the documented build
  environment; surrounding behavior is tested with a controlled transport.
- General-web behavior is not claimed. Live retrieval has been demonstrated
  only through the restrictive approved-host policy path.
- External actions do not have an exactly-once guarantee. An interrupted action
  is recorded for review rather than guessed to have succeeded.
- State consistency can be verified, but state is not cryptographically signed
  or tamper-evident.
- There is no daemon, multi-agent coordination, distributed execution, or
  automatic source discovery.

These boundaries are deliberate. ATHERYN prefers an explicit `unverified` or
`inconclusive` status over a stronger claim the evidence cannot support.

## Project structure

```text
atheryn/
├── cli.py              # command-line interface
├── controller.py       # research lifecycle and action selection
├── state.py            # durable snapshots and verification
├── models.py           # research entities and epistemic state
├── experiments.py      # execution and artifact management
├── sandbox.py          # design policy and subprocess restrictions
├── critic.py           # replication, falsification, and final review
├── stats.py            # timing and exact-metric comparisons
├── graph.py            # evidence-aware knowledge graph
├── autonomy.py         # queue, policy, lease, and retry model
├── scheduler.py        # bounded restart-safe autonomous execution
├── retrieval.py        # restricted HTTPS retrieval
├── web_evidence.py     # provenance and claim handling
├── brain.py            # proposal-provider abstraction
├── proposals.py        # proposal validation and audit trail
├── replay.py           # experiment replay and comparison
├── report.py           # dossier, timeline, status, and HTML
└── domains/
    ├── base.py         # domain contract and registry
    ├── algobench.py    # sorting research domain
    └── graphbench.py   # shortest-path research domain
```

## Documentation

| Document | Purpose |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Module map, control flow, and architectural boundaries |
| [`docs/RESEARCH_MODEL.md`](docs/RESEARCH_MODEL.md) | Entities, epistemic states, lifecycle, and critic policy |
| [`docs/AUTONOMY.md`](docs/AUTONOMY.md) | Work items, policy, leases, retries, and bounded execution |
| [`docs/REPRODUCIBILITY.md`](docs/REPRODUCIBILITY.md) | Artifact guarantees, replay, portability, and recovery |
| [`docs/EVIDENCE_ACQUISITION.md`](docs/EVIDENCE_ACQUISITION.md) | Retrieval policy, provenance, and source conflicts |
| [`docs/LLM_INTEGRATION.md`](docs/LLM_INTEGRATION.md) | Provider validation, auditing, and trust boundaries |
| [`docs/SECOND_DOMAIN.md`](docs/SECOND_DOMAIN.md) | Generalization test and gaps exposed by `graphbench` |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Mission operation and recovery procedures |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Safe-use model and unsupported protections |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Architectural decisions and rejected alternatives |
| [`docs/reports/FLAGSHIP_EVALUATION.md`](docs/reports/FLAGSHIP_EVALUATION.md) | Pre-registered comparison and results |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history and evidence-backed changes |
| [`ROADMAP.md`](ROADMAP.md) | Planned directions and deferred work |

Verification reports live in [`docs/verification/`](docs/verification/),
security analyses in [`docs/security/`](docs/security/), and executed
adversarial tests in [`docs/red_team/`](docs/red_team/).

## Development and verification

Before submitting a change, run:

```bash
python3 -m unittest discover -s tests
python3 tools/check_artifacts_portable.py .
python3 -m atheryn verify --dir examples/flagship_run
python3 -m atheryn verify \
  --dir examples/final_flagship_mission/atheryn_full
```

The project follows one contribution rule:

> **No capability is complete without evidence.**

A feature should include a test that exercises it. A behavioral claim should
name the command or artifact that produced it. Honest labels such as
`IMPLEMENTED_BUT_UNVERIFIED` are welcome; unsupported certainty is not.

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md), and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) before contributing.

## License

ATHERYN is available under the [MIT License](LICENSE).

---

<div align="center">
  <strong>ATHERYN does not merely produce answers.</strong>
  <br />
  It records how each answer was tested, challenged, revised, and justified.
</div>
