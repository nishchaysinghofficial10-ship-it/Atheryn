# Changelog

Entries are intentionally brief. Each one should say what changed, why it
mattered, and where to find the supporting test or artifact.

This file covers all notable changes. Every number below came from a command
run against the commit being described.

## [Unreleased]

### Fixed
- Experiment runs and replays now share one audited sandbox bootstrap instead
  of relying on `preexec_fn`. The new path works with macOS's large inherited
  virtual-address-space reservation and kills the full process group on a
  wall-clock timeout.
- A sandbox launch failure is recorded as a failed experiment, so the mission
  remains inspectable and resumable instead of stopping mid-step.
- Quick-start instructions now name the 2.1.0 archive and no longer carry a
  test count that becomes stale whenever coverage is added.

### Verified
- **269 tests** pass on CPython 3.15.0rc1, macOS 26.5.2 arm64, including a 2 GB
  allocation attempt under a 128 MB sandbox budget.

## [2.1.0] — architecture gaps closed, live autonomous retrieval

**268 tests**, CPython 3.10–3.14 on Linux x86-64.

### Added
- **Metric kinds** (`stats.TIMING` / `stats.EXACT`). Domains can now say what
  kind of metric they expose. Exact counts bypass the timing-noise gate, and an
  exact tie stays a tie. This closes the first gap uncovered by the second
  domain: the significance layer had assumed every metric behaved like timing.
- **Invalidity as a core concept** (`models.Invalidity` and
  `state.record_invalidity/is_valid/valid_candidates`), including a dossier
  section and `verify()` coverage. Previously, “this candidate is wrong under
  these conditions” lived inside each domain, which meant every new domain had
  to rebuild the same exclusion logic. `graphbench` now records the BFS boundary
  through the core.
- Dossiers now identify exact metrics and explain why conclusions based on
  those metrics transfer.

### Verified
- **Live autonomous retrieval.** A bounded autonomous run made a real HTTPS
  request through the full policy stack: HTTP 200, 44,051 bytes, sha256
  `674d514b968e2a9b`, robots `absent`, and address pinning enabled. The run
  produced 5 SPECULATION claims and 0 evidence items, and `verify` passed. In
  other words, autonomous retrieval is no longer fixture-only.

## [2.0.0] — 2026-08-11 — first public release

The first public release includes two research domains, bounded autonomy, safe
evidence acquisition, a validated LLM proposal layer, and a pre-registered
evaluation of what the machinery actually buys.
**261 tests**, CPython 3.10–3.14 on Linux x86-64.

### Added
- **Second research domain** (`graphbench`): single-source shortest paths, a
  machine-independent metric (edge relaxations), and a genuine correctness
  boundary (`bfs_unit` works only with unit weights). The two architecture gaps
  it revealed are documented in `docs/SECOND_DOMAIN.md`.
- **Bounded autonomy** (v1.5): durable, schema-validated work items; a
  deterministic policy backed by append-only decision records; a restart-safe
  scheduler tick; an atomic single-writer mission lease; conservative recovery
  for interrupted work; typed retries with capped backoff; and an `autonomy`
  CLI group. There is still no daemon.
- **Safe web evidence acquisition** (v1.4): HTTPS-only, policy-restricted
  retrieval with full source provenance, passage-linked claims capped at
  SPECULATION, and visible source conflicts.
- **Live LLM proposal layer** (v1.3): four validated proposal types, an
  append-only proposal audit, and typed provider errors. The live network call
  is still **unverified** because no credential was available.
- **Performance validity** (v1.2): result schema v2 (per-trial samples,
  digests, and environment), conservative significance rules, and three-tier
  replay.
- **Flagship evaluation**: a pre-registered question run through three
  workflows (`docs/reports/FLAGSHIP_EVALUATION.md`).
- Release scaffolding: LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY,
  issue/PR templates, CI.

### Fixed
- Absolute artifact paths broke copied or archived missions and caused
  `verify` to return a false PASS (v1.1).
- Replay mistakenly treated host timing noise as a failure (v1.1).
- Checkpoint recovery: missing primary with a valid backup, structurally
  invalid snapshots, torn event-log lines, orphaned experiments, programmatic
  resume of a paused mission (v1.1).
- `robots.txt` fetched outside the restricted path; unbounded gzip
  decompression; truncated compressed streams returning partial content
  (v1.4.1).
- Every robots failure was recorded as `absent`; now that label is used only
  for HTTP 404 (v1.4.2).
- Falsification probes converting inconclusive results into confident scope
  claims (v1.0).
- Shared mission config: `create()` retained a reference to the global profile
  table, so editing one mission could rewrite the defaults for later missions
  (v1.7).

### Known limitations
There is no exactly-once guarantee for external actions, kernel-grade
isolation, or cross-machine timing reproducibility. The live LLM call and
general-web retrieval remain unverified. There is also no daemon, multi-agent
coordination, or distributed execution. See
`docs/reports/ATHERYN_AUTONOMY_IMPLEMENTATION_REPORT.md` and the individual
verification reports for the full list.
