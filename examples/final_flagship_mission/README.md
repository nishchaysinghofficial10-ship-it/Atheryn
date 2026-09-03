# Flagship evaluation artifacts

This directory is the replayable record for the flagship comparison; begin with the evaluation results, then follow any claim back to its workflow artifacts.

This directory is **not** a single ATHERYN mission — `atheryn verify --dir .` will
correctly report that there is no project here. It holds the evaluation as a
whole:

```
PREREGISTRATION.json      written before any workflow ran
EVALUATION_RESULTS.json   the machine-readable three-way comparison
baseline/                 workflow A — benchmark once, report winners
proposal_only/            workflow B — proposals only, nothing tested
atheryn_full/              workflow C — the full research loop  <- verify THIS
```

Verify the missions individually:

```bash
python -m atheryn verify --dir examples/final_flagship_mission/atheryn_full
python -m atheryn report --dir examples/final_flagship_mission/atheryn_full
```

Read `docs/reports/FLAGSHIP_EVALUATION.md` for the analysis. The headline: the
baseline workflow named an incorrect candidate as the winner on three of four
topologies; the full loop named zero.
