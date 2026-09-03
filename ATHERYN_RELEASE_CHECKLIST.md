# ATHERYN — Release Checklist

Use this checklist alongside the packaged release. A checked box only counts if
there is still a command or artifact behind it.

This checklist was run for 2.0.0. Every completed line has a command behind it,
and nothing is ticked unless that command ran at the release commit.

## Clean-room onboarding

The onboarding pass started from a fresh `git archive`, extracted into a new
directory. Only the public documentation was used—no local setup notes or
untracked files.

| # | Step | Command | Result |
|---|---|---|---|
| 1 | Fresh archive extracts | `git archive --format=zip HEAD` → unzip | 13 top-level entries, no caches |
| 2 | Install | *(none required)* `python3 -c "import atheryn"` | imported without installing anything, v2.0.0 |
| 3 | Run tests | `python3 -m unittest discover -s tests` | **261 tests, OK, 99.8s** |
| 4 | Run a demo | `atheryn init … --profile fast && atheryn run` | COMPLETED — "no high-value next experiment remained" |
| 5 | Inspect a dossier | `atheryn report --dir runs/demo` | all sections present, including prediction ledger, falsification, and threats to validity |
| 6 | Pause and resume | `atheryn run --steps 2` then `atheryn run` | paused durably, resumed to completion, `verify` clean |
| 7 | Reproduce an experiment | `atheryn replay --dir examples/graph_mission --exp …` | **REPLAY PASS** — correctness, inputs, outputs identical; timing reported, not asserted |
| 8 | Autonomy demo | `tools/autonomy_demo.py` + `atheryn autonomy status` | COMPLETED, queue `{done: 11, queued: 2}`, lease free, `verify` clean |
| 9 | Flagship evaluation | `tools/flagship_evaluation.py` | reproduced: baseline names 3 incorrect winners, ATHERYN names 0 |
| 10 | Hygiene | portability guard; cache/secret scan | no absolute paths, 0 cache artifacts in the archive, no keys outside test fixtures |

**A note on step 3:** the total is **261** when every shipped example is
present. An earlier working-tree run reported 258 because three tests skip if
the example mission they inspect is missing. With that mission in place, those
tests run and pass. Both runs were real; 261 is the correct number for a
complete checkout, so that is the figure used in the documentation.

## Repository hygiene

- [x] No secrets in source, artifacts, logs, reports, or history. A scan for
      `sk-ant-` and `api_key=` found only synthetic fixtures under `tests/`
- [x] No machine-specific absolute paths — `tools/check_artifacts_portable.py`
      is clean and runs in CI
- [x] No cache or build artifacts tracked — `.gitignore` added; `git ls-files`
      shows 0 `__pycache__`/`.pyc` entries
- [x] No unsupported claims. A search for "kernel-grade", "fully isolated",
      and "exactly-once" finds only explicit **denials**, and
      `test_documentation_does_not_claim_kernel_grade_isolation` fails the
      build if that changes

## Required files

- [x] `README.md` — what ATHERYN is and is not, domains, install, demo,
      reproduction, safety boundaries, limitations, contributing
- [x] `LICENSE` (MIT) · `CHANGELOG.md` · `CONTRIBUTING.md` ·
      `CODE_OF_CONDUCT.md` · `SECURITY.md` (with responsible-use statement)
- [x] Issue templates (bug, feature) and a PR template that demands evidence
- [x] CI workflow — matrix, portability, fresh mission, autonomy, evidence
- [x] `docs/release/RELEASE_NOTES.md`, this checklist
- [x] Architecture, operations, reproducibility, autonomy, evidence, LLM,
      second-domain, security and verification documentation
- [x] Example missions: `demo_run`, `flagship_run`, `graph_mission`,
      `evidence_demo`, `autonomy_demo`, `final_flagship_mission`

## Evidence-backed claims

- [x] Every test count in documentation was produced by a command at this commit
- [x] Every benchmark figure names its environment and scope
- [x] The live LLM call is labelled **UNVERIFIED**, with the exact command
      needed to verify it
- [x] General-web retrieval is labelled verified **only against allow-listed
      hosts**
- [x] No novelty claimed — the flagship evaluation says plainly that ATHERYN
      rediscovered textbook results under budget

## Not ticked, deliberately

- [ ] **CI has never executed.** The build environment has no runner. This
      **closes on the first push** to a host with Actions enabled—the
      workflow already covers the 3.10–3.14 matrix, portability, the relocated
      mission, the archive round-trip, the fixture evidence pipeline and the
      autonomy demo. There is nothing new to write; run it once and record the
      URL.
      Every job's commands were run locally and are recorded as
      "CI-equivalent"; the workflow file itself is unexecuted. A first push
      will be its first real run.
- [ ] **macOS is untested.** The release has only run on Linux. One
      `python -m unittest discover -s tests` run on a Mac will either close this
      item or produce a useful bug report. Windows is unsupported and fails
      with an explicit message.
- [ ] **Live provider call unperformed.** No credential existed here.
      **One command closes it:**
      `export ANTHROPIC_API_KEY=... && python tools/live_llm_check.py --dir runs/live_check --provider-calls 2`
      Then paste `runs/live_check/logs/live_check_summary.json` into
      `docs/verification/LLM_VERIFICATION_REPORT.md` §7 and tick this box.

## Release readiness

The release is ready to go public, provided those three exceptions stay visible
in the release notes rather than disappearing into a footnote. The gating
condition was a clean-room run using public documentation alone, and that run
passed end to end.
