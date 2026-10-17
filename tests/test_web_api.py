"""The web API (atheryn_server): reads, guards, static files, and — on POSIX —
a full mission driven over HTTP from creation to a verified dossier."""
from __future__ import annotations

import http.client
import json
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path

from atheryn_server import Settings, create_server
from atheryn_server import missions as M

REPO = Path(__file__).absolute().parent.parent


class _Server:
    def __init__(self, **overrides) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="atheryn_web_"))
        settings = Settings(host="127.0.0.1", port=0, runs_dir=self.tmp / "runs",
                            web_dir=REPO / "web", examples_dir=REPO / "examples",
                            **overrides)
        self.server, self.app = create_server(settings)
        self.server.RequestHandlerClass.log_message = lambda *a, **k: None
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={"poll_interval": 0.1}, daemon=True)
        self.thread.start()

    def conn(self) -> http.client.HTTPConnection:
        return http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)

    def call(self, method, path, body=None, headers=None, conn=None):
        own = conn is None
        conn = conn or self.conn()
        hdrs = {"Accept": "application/json"}
        payload = None
        if body is not None:
            payload = json.dumps(body).encode()
            hdrs["Content-Type"] = "application/json"
        hdrs.update(headers or {})
        conn.request(method, path, body=payload, headers=hdrs)
        res = conn.getresponse()
        raw = res.read()
        if own:
            conn.close()
        ctype = res.getheader("Content-Type", "")
        data = json.loads(raw) if ctype.startswith("application/json") and raw else raw
        return res.status, data, res

    def close(self) -> None:
        self.app.runtime.shutdown(wait_s=10)
        self.server.shutdown()
        self.server.server_close()
        shutil.rmtree(self.tmp, ignore_errors=True)


class WebApiReadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = _Server()

    @classmethod
    def tearDownClass(cls):
        cls.s.close()

    def test_health_and_meta(self):
        status, data, _ = self.s.call("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertEqual(data["can_execute"], M.can_execute())
        status, meta, _ = self.s.call("GET", "/api/meta")
        self.assertEqual(status, 200)
        self.assertEqual({d["name"] for d in meta["domains"]}, {"algobench", "graphbench"})
        self.assertIn("COMPLETED", meta["lifecycle"])
        self.assertEqual(meta["decisive_rule"]["min_trials"], 5)

    def test_shipped_missions_are_listed_and_read_only(self):
        status, data, _ = self.s.call("GET", "/api/missions")
        self.assertEqual(status, 200)
        ids = {m["id"] for m in data["missions"]}
        self.assertIn("graph_mission", ids)
        self.assertIn("final_flagship_mission--atheryn_full", ids)
        status, m, _ = self.s.call("GET", "/api/missions/graph_mission")
        self.assertEqual(status, 200)
        self.assertFalse(m["writable"])
        self.assertEqual(m["phase"], "COMPLETED")
        self.assertTrue(m["hypotheses"])
        for path in ("run", "pause", "cancel"):
            status, err, _ = self.s.call("POST", f"/api/missions/graph_mission/{path}", {})
            self.assertEqual(status, 403, path)

    def test_examples_are_not_modified_by_reads(self):
        root = REPO / "examples" / "graph_mission"
        before = {p: p.stat().st_mtime for p in root.rglob("*") if p.is_file()}
        for path in ("", "/events", "/results", "/dossier"):
            status, _, _ = self.s.call("GET", f"/api/missions/graph_mission{path}")
            self.assertEqual(status, 200, path)
        self.s.call("POST", "/api/missions/graph_mission/verify", {})
        after = {p: p.stat().st_mtime for p in root.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_events_paginate_without_gaps(self):
        _, full, _ = self.s.call("GET", "/api/missions/graph_mission/events?after=0&limit=1000")
        seen, after = [], 0
        while True:
            _, page, _ = self.s.call("GET", f"/api/missions/graph_mission/events?after={after}&limit=7")
            if not page["events"]:
                break
            seen.extend(e["i"] for e in page["events"])
            after = page["next"]
        self.assertEqual(seen, list(range(full["total"])))

    def test_results_drop_raw_samples_but_keep_correctness(self):
        _, data, _ = self.s.call("GET", "/api/missions/graph_mission/results")
        rows = [r for res in data["results"] for r in res["rows"]]
        self.assertTrue(rows)
        self.assertTrue(all("samples" not in r for r in rows))
        self.assertTrue(any(r.get("correct") is False for r in rows))   # bfs_unit

    def test_experiment_detail_and_unknown_ids(self):
        _, m, _ = self.s.call("GET", "/api/missions/graph_mission")
        exp = m["experiments"][0]["id"]
        status, x, _ = self.s.call("GET", f"/api/missions/graph_mission/experiments/{exp}")
        self.assertEqual(status, 200)
        self.assertIn("ALGORITHMS", x["code"])
        for bad in ("exp_deadbeef00", "..%2Fstate.json", "x"):
            status, _, _ = self.s.call("GET", f"/api/missions/graph_mission/experiments/{bad}")
            self.assertEqual(status, 404, bad)
        for bad in ("nope", "..", "..%2F..%2Fetc", "A-UPPER"):
            status, _, _ = self.s.call("GET", f"/api/missions/{bad}")
            self.assertEqual(status, 404, bad)

    def test_create_validation(self):
        cases = [
            ({"question": "short", "domain": "algobench"}, 400),
            ({"question": "Which sort wins where?", "domain": "physics"}, 400),
            ({"question": "Which sort wins where?", "domain": "algobench",
              "profile": "graph_fast"}, 400),
            ({"question": "Which sort wins where?", "domain": "algobench",
              "profile": "flagship"}, 400),
            ({"question": "Which sort wins where?", "domain": "algobench",
              "max_experiments": 999}, 400),
            ({"question": "Which sort wins where?", "domain": "algobench",
              "brain": "anthropic"}, 400),
        ]
        for body, expected in cases:
            status, data, _ = self.s.call("POST", "/api/missions", body)
            self.assertEqual(status, expected, body)
            self.assertIn("error", data)

    def test_keep_alive_survives_ignored_bodies(self):
        # Regression: a body the endpoint does not read must not be parsed as
        # the start of the next request on the same connection.
        conn = self.s.conn()
        try:
            for _ in range(3):
                status, _, _ = self.s.call("POST", "/api/missions/graph_mission/verify",
                                           {"ignored": True}, conn=conn)
                self.assertEqual(status, 200)
            status, data, _ = self.s.call("GET", "/api/health", conn=conn)
            self.assertEqual(status, 200)
            self.assertTrue(data["ok"])
        finally:
            conn.close()

    def test_static_site_and_headers(self):
        status, body, res = self.s.call("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"ATHERYN", body)
        self.assertIn("default-src 'self'", res.getheader("Content-Security-Policy"))
        self.assertEqual(res.getheader("X-Content-Type-Options"), "nosniff")
        status, body, _ = self.s.call("GET", "/missions/graph_mission")
        self.assertEqual(status, 200)
        self.assertIn(b"data-m-question", body)
        for bad in ("/../atheryn/cli.py", "/%2e%2e/atheryn/cli.py", "/.gitignore",
                    "/assets/../../atheryn/cli.py"):
            status, _, _ = self.s.call("GET", bad)
            self.assertEqual(status, 404, bad)

    def test_static_revalidation_returns_304(self):
        _, _, res = self.s.call("GET", "/assets/css/site.css")
        lm = res.getheader("Last-Modified")
        self.assertTrue(lm)
        status, _, _ = self.s.call("GET", "/assets/css/site.css",
                                   headers={"If-Modified-Since": lm})
        self.assertEqual(status, 304)


class WebApiTokenTests(unittest.TestCase):
    def test_writes_need_the_token_reads_do_not(self):
        s = _Server(token="s3cret-test-token")
        try:
            status, _, _ = s.call("GET", "/api/missions")
            self.assertEqual(status, 200)
            body = {"question": "Which sort wins where?", "domain": "algobench"}
            status, _, _ = s.call("POST", "/api/missions", body)
            self.assertEqual(status, 401)
            status, _, _ = s.call("POST", "/api/missions", body,
                                  headers={"Authorization": "Bearer wrong"})
            self.assertEqual(status, 401)
            status, m, _ = s.call("POST", "/api/missions", body,
                                  headers={"Authorization": "Bearer s3cret-test-token"})
            self.assertEqual(status, 201)
            self.assertTrue(m["writable"])
            self.assertEqual(m["phase"], "CREATED")
        finally:
            s.close()


class EventTailTests(unittest.TestCase):
    def test_torn_tail_is_left_for_the_next_poll(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "logs").mkdir()
            log = tmp / "logs" / "events.jsonl"
            log.write_text('{"ts": 1, "kind": "a", "msg": "one"}\n{"ts": 2, "ki')
            first = M.read_events(tmp, 0)
            self.assertEqual(first["total"], 1)
            self.assertEqual(first["next"], 1)
            log.write_text('{"ts": 1, "kind": "a", "msg": "one"}\n'
                           '{"ts": 2, "kind": "b", "msg": "two"}\n')
            second = M.read_events(tmp, first["next"])
            self.assertEqual([e["msg"] for e in second["events"]], ["two"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


@unittest.skipUnless(M.can_execute(), "experiments need POSIX rlimits")
class WebMissionLifecycleTests(unittest.TestCase):
    """A real mission, created and driven over HTTP only."""

    def test_create_run_complete_verify_replay(self):
        s = _Server()
        try:
            body = {"question": "Web smoke: which sort wins where?", "domain": "algobench",
                    "max_experiments": 4, "compute_minutes": 2, "autostart": True}
            status, m, _ = s.call("POST", "/api/missions", body)
            self.assertEqual(status, 201)
            self.assertEqual(m["autostart"], "started")
            mid = m["id"]
            status, _, _ = s.call("POST", f"/api/missions/{mid}/run", {})
            self.assertIn(status, (409, 429))           # one writer per mission

            deadline = time.time() + 240
            while time.time() < deadline:
                _, m, _ = s.call("GET", f"/api/missions/{mid}")
                if not m["run"]["running"]:
                    break
                time.sleep(0.5)
            self.assertFalse(m["run"]["running"], "mission did not finish in time")
            self.assertEqual(m["run"]["status"], "finished", m["run"])
            self.assertEqual(m["phase"], "COMPLETED")
            self.assertTrue(m["stop_reason"])
            self.assertTrue(m["experiments"])

            _, v, _ = s.call("POST", f"/api/missions/{mid}/verify", {})
            self.assertTrue(v["ok"], v["problems"])
            _, d, _ = s.call("GET", f"/api/missions/{mid}/dossier")
            self.assertIn("ATHERYN Research Dossier", d["markdown"])
            _, ev, _ = s.call("GET", f"/api/missions/{mid}/events")
            kinds = {e["kind"] for e in ev["events"]}
            self.assertIn("web_run", kinds)
            self.assertIn("stopped", kinds)

            exp = next(x["id"] for x in m["experiments"] if x["status"] == "completed")
            status, r, _ = s.call("POST", f"/api/missions/{mid}/experiments/{exp}/replay", {})
            self.assertEqual(status, 200)
            self.assertTrue(r["ok"], r["lines"])
            self.assertEqual(r["hard_failures"], 0)

            status, _, _ = s.call("POST", f"/api/missions/{mid}/run", {})
            self.assertEqual(status, 409)               # terminal
        finally:
            s.close()

    def test_pause_then_resume_from_checkpoint(self):
        s = _Server()
        try:
            body = {"question": "Web pause: which sort wins where?", "domain": "algobench",
                    "max_experiments": 4, "compute_minutes": 2}
            _, m, _ = s.call("POST", "/api/missions", body)
            mid = m["id"]
            status, _, _ = s.call("POST", f"/api/missions/{mid}/run", {"steps": 3})
            self.assertEqual(status, 202)
            for _ in range(240):
                _, m, _ = s.call("GET", f"/api/missions/{mid}")
                if not m["run"]["running"]:
                    break
                time.sleep(0.25)
            self.assertEqual(m["phase"], "PAUSED")
            self.assertEqual(m["step"], 3)
            _, v, _ = s.call("POST", f"/api/missions/{mid}/verify", {})
            self.assertTrue(v["ok"], v["problems"])
            status, r, _ = s.call("POST", f"/api/missions/{mid}/cancel", {})
            self.assertEqual(status, 202)
            _, m, _ = s.call("GET", f"/api/missions/{mid}")
            self.assertEqual(m["phase"], "CANCELLED")
        finally:
            s.close()


if __name__ == "__main__":
    unittest.main()
