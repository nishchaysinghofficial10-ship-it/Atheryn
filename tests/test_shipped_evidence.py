"""Integrity of the experiment evidence shipped under examples/.

Every schema-v2 runner hashes its own source into `code_digest` when it runs,
and `replay` refuses a runner whose bytes no longer match. That check needs a
POSIX sandbox, so it only ran in one CI job; a bulk edit of examples/ (the
v2.1.0 project rename, see docs/verification/ERRATUM_RENAMED_EVIDENCE.md)
went unnoticed until that job finally ran. This test recomputes the same
digest with nothing but hashlib, so any platform catches such an edit.
"""
import hashlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from atheryn.replay import RESULT_SCHEMA_VERSION                # noqa: E402

REPO = Path(__file__).resolve().parents[1]
EXAMPLES = REPO / "examples"


def _file_digest(path: Path) -> str:
    # Same rule as file_digest() in the generated runners.
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


class TestShippedRunnersMatchTheirRecords(unittest.TestCase):

    def test_every_recorded_code_digest_matches_its_runner(self):
        if not EXAMPLES.exists():
            self.skipTest("examples/ not present")
        checked, mismatched = 0, []
        for result in sorted(EXAMPLES.rglob("experiments/*/result.json")):
            payload = json.loads(result.read_text())
            recorded = payload.get("code_digest")
            if payload.get("schema_version", 1) >= RESULT_SCHEMA_VERSION:
                self.assertTrue(recorded, f"{result} is schema v2 but records "
                                          f"no code_digest")
            if not recorded:
                continue        # schema-1 results never recorded one
            runner = result.parent / "run.py"
            actual = _file_digest(runner)
            checked += 1
            if actual != recorded:
                mismatched.append(f"{runner.relative_to(REPO).as_posix()}: "
                                  f"recorded {recorded}, file {actual}")
        self.assertGreater(checked, 0, "no shipped result records a code_digest")
        self.assertEqual(mismatched, [],
                         "shipped run.py no longer matches the code that "
                         "produced its result (stored evidence must not be "
                         "edited):\n  " + "\n  ".join(mismatched))


if __name__ == "__main__":
    unittest.main()
