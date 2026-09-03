# ATHERYN — Second Research Domain (`graphbench`)

This note explains the design of `graphbench` and, just as importantly, the
places where adding a second domain forced the core to change.

## 1. Why this domain

The domain interface had only one implementation. Calling the core
“domain-agnostic” was therefore an architectural claim, not an evidence-backed
one. The honest way to test it was to add a second domain and see what broke.

`graphbench` (single-source shortest paths) was chosen over the alternatives
because it is deterministic, safe to execute, cheap enough to run in CI—and
because it differs from sorting in four ways that stress the core rather than
flatter it:

| | `algobench` (sorting) | `graphbench` (shortest paths) |
|---|---|---|
| Input | an array; "regime" = element order | a graph; "regime" = **topology** (sparsity, lattice, scale-free, chains) |
| Correctness | a predicate (is it sorted?) | a whole answer vector checked against a reference implementation |
| Primary metric | wall-clock time only | wall-clock **and edge relaxations — a machine-independent count** |
| Failure modes | slow candidates | a candidate that is **silently wrong outside its precondition** |

Optimisation and scheduling were considered, then rejected: objective quality
is approximate, so “correct” becomes a threshold (a weaker check than sorting
already had). Search over generated data was also rejected because its shape is
too close to sorting.

## 2. What was implemented

The implementation lives in one file, `atheryn/domains/graphbench.py`, and uses
only the `ResearchDomain` hooks. It required no new or duplicated controller,
state, budget, critic, replication, reporting, replay, or autonomy code.

- **Baselines:** `dijkstra_heap`, `dijkstra_array` (O(V²) scan),
  `bellman_ford`, `spfa`, and `bfs_unit`. That last baseline is correct *only*
  on unit-weight graphs. It is included on purpose so the domain has a real
  correctness boundary, not just several performance boundaries.
- **Generators:** `sparse_random`, `dense_random`, `grid_2d`, `scale_free`,
  `long_chain`, and `unit_weight`. Every generator is deterministic from a seed
  and produces a connected graph. An unreachable vertex would be a broken
  benchmark, not a topology; that is why `grid_2d` returns the largest square
  lattice ≤ n instead of padding.
- **Correctness:** every trial is checked against a reference Dijkstra run in
  the same runner. A wrong answer is **recorded, not crashed** because it tells
  us something useful about the candidate’s preconditions.
- **Metrics:** per-trial timings (schema v2, with samples, SEM, digests,
  environment) **plus** a median relaxation count.
- **Hypothesis templates, experiment designs, replication, falsification
  probes** (boundary size + unseen topologies), and **knowledge gaps**.

The check vocabulary is: `fastest_on`, `beats`, `fewer_relaxations`,
`most_relaxations`, `correct_on`, `incorrect_on`. The first two go through the
same conservative significance gate as sorting; the relaxation checks do not,
because **a count is exact**. A statistical test would add nothing there.

## 3. Architecture gaps this exposed

The second domain exposed two substantive gaps.

**3.1 The significance layer is calibrated for a metric this domain barely
needs.** In the shipped example mission, both *timing* hypotheses were
`inconclusive` after 5 trials because the standard errors overlapped on a
contended single-core host. The *relaxation* hypotheses, meanwhile, were
decisive because they used exact counts. Sorting offered no machine-independent
metric, so v1.2’s performance-validity machinery was understandably built
around safe timing claims. Here, though, the honest conclusions came from
counting rather than timing. The core treated every metric as timing-shaped,
forcing a domain with a deterministic metric to route around the statistics
layer instead of simply declaring, “this metric is exact.”

**3.2 Correctness is domain-private.** `state.failures` gained an
`incorrect_output` kind by convention, not by contract. The core had no
first-class way to say, “this candidate is invalid under these conditions,” so
`graphbench` enforced the exclusion itself by dropping a wrong candidate from
rankings inside `_eval`. A third domain would have to repeat that work, which is
a good sign the concept belongs in the core.

Neither gap was hidden behind domain-specific glue. Both are asserted in
`test_second_domain.py`, and both became the recommended next architecture
work.

### Closed in v2.1

Both gaps are now fixed in the core rather than worked around in the domain:

- **Gap 3.1** — `stats` now has metric kinds. A domain declares
  `metric_kinds = {"mean_s": TIMING, "relaxations": EXACT}`, and
  `stats.compare(..., metric_kind=EXACT)` skips the trial minimum, the SEM gate
  and the margin floor, because a deterministic count has no noise to gate. An
  exact tie is reported as a tie. The dossier states which metrics are exact and
  why conclusions resting on them transfer.
- **Gap 3.2** — invalidity is now a core concept: `Invalidity` in `models`,
  `state.record_invalidity()` / `is_valid()` / `valid_candidates()`, a dossier
  section, and `verify()` coverage. `graphbench` now records the BFS boundary
  through the core, and rankings ask the core who is still valid. A third domain
  inherits all of it.

**What held up well:** the controller, lifecycle, budgets, checkpointing,
critic (replication + falsification), knowledge graph, reporting, replay,
portability guard and the autonomy scheduler all took the new domain with
**zero changes**. That was the encouraging part. The
`test_core_modules_do_not_mention_a_specific_domain` test also confirms that
eleven core modules never name a domain, algorithm, or topology.

## 4. Evidence

```bash
python -m atheryn init "Which single-source shortest-path method wins on which \
graph topology…" --dir runs/graph --domain graphbench --profile graph_standard \
  --max-experiments 40 --brain mock
python -m atheryn autonomy run --dir runs/graph --max-steps 30 --max-wall-s 1200
python -m atheryn verify --dir runs/graph
```

The shipped example is `examples/graph_mission/`. It ran autonomously in 12
actions over 15 seconds and stopped with reason `completed`: 6 experiments, 5
hypotheses, 10 evidence items, and a clean `verify` result.

**Findings, including the negative ones:**

| Hypothesis | Outcome | Basis |
|---|---|---|
| Heap Dijkstra is fastest on sparse graphs | **weakened** | SPFA led, but the gap (0.114 ms) was inside 3× the combined SEM — inconclusive, not refuted |
| Array Dijkstra beats the heap on dense graphs | **weakened** | measured −31%, still inside the uncertainty band at 5 trials |
| Bellman-Ford performs the most relaxations everywhere | provisionally supported | highest count on all four topologies |
| SPFA uses fewer relaxations than Bellman-Ford on sparse graphs | **accepted with scope** | 4,907 vs 21,476 (+77%), exact counts; replicated; survived falsification; extends to `long_chain` and `scale_free` |
| BFS is correct on unit weights and wrong on weighted graphs | **accepted with scope** | correct on `unit_weight`; **incorrect** on `sparse_random`, `dense_random`, `grid_2d` — each recorded as a failure and excluded from rankings |

Four times, the system noticed that a topology’s apparent winner was not
statistically separable from the alternatives and declined to name one.

## 5. Scope of these conclusions

These results come from pure-Python implementations on CPython 3.12.3, using
one Linux x86-64 core, undirected connected graphs with positive integer
weights, n ≤ 512, source vertex 0, and 5 trials per cell. **Relaxation counts
transfer** because they are exact properties of the algorithm on the generated
graph. **Timings do not.** None of this should be read as a general claim about
shortest-path algorithms, other languages or sizes, directed graphs, or
negative weights. Bellman-Ford’s real advantage, for example, is untested here
and remains recorded as a knowledge gap.

## 6. No new execution capability

`graphbench` runs inside the same sandbox as the first domain: a generated
runner from an audited in-repo template, `validate_design()` before spawn,
rlimits, a scrubbed environment, output caps, and a wall-clock timeout. It adds
no shell access, no file access outside the experiment directory, and no
network access.
