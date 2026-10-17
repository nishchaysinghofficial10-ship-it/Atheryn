"""HTTP routing, static files, and the request-level guards.

    GET  /api/health
    GET  /api/meta
    GET  /api/evaluation
    GET  /api/missions
    POST /api/missions                         {question, domain, profile, ...}
    GET  /api/missions/<id>
    GET  /api/missions/<id>/events?after=N
    GET  /api/missions/<id>/results
    GET  /api/missions/<id>/dossier
    GET  /api/missions/<id>/experiments/<exp>
    POST /api/missions/<id>/run                {steps?}
    POST /api/missions/<id>/pause
    POST /api/missions/<id>/cancel
    POST /api/missions/<id>/verify
    POST /api/missions/<id>/experiments/<exp>/replay

Everything else is a file from `web/`, with `/missions/<id>` mapped to
`web/mission.html`.
"""
from __future__ import annotations

import gzip
import hmac
import json
import mimetypes
import re
import sys
import threading
import time
from collections import defaultdict, deque
from email.utils import formatdate, parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from atheryn import __version__

from . import missions as M
from .settings import Settings

MAX_BODY = 16 * 1024
GZIP_MIN = 1024
GZIP_TYPES = ("text/", "application/json", "application/javascript",
              "image/svg+xml")

CSP = ("default-src 'self'; "
       "script-src 'self' https://cdn.jsdelivr.net; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; "
       "img-src 'self' data:; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; "
       "object-src 'none'")

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("application/manifest+json", ".webmanifest")

ROUTES: list[tuple[str, re.Pattern, str]] = [
    ("GET", re.compile(r"^/api/health$"), "health"),
    ("GET", re.compile(r"^/api/meta$"), "meta"),
    ("GET", re.compile(r"^/api/evaluation$"), "evaluation"),
    ("GET", re.compile(r"^/api/missions$"), "list_missions"),
    ("POST", re.compile(r"^/api/missions$"), "create_mission"),
    ("GET", re.compile(r"^/api/missions/(?P<mid>[^/]+)$"), "get_mission"),
    ("GET", re.compile(r"^/api/missions/(?P<mid>[^/]+)/events$"), "events"),
    ("GET", re.compile(r"^/api/missions/(?P<mid>[^/]+)/results$"), "results"),
    ("GET", re.compile(r"^/api/missions/(?P<mid>[^/]+)/dossier$"), "dossier"),
    ("GET", re.compile(r"^/api/missions/(?P<mid>[^/]+)/experiments/(?P<exp>[^/]+)$"),
     "experiment"),
    ("POST", re.compile(r"^/api/missions/(?P<mid>[^/]+)/run$"), "run"),
    ("POST", re.compile(r"^/api/missions/(?P<mid>[^/]+)/pause$"), "pause"),
    ("POST", re.compile(r"^/api/missions/(?P<mid>[^/]+)/cancel$"), "cancel"),
    ("POST", re.compile(r"^/api/missions/(?P<mid>[^/]+)/verify$"), "verify"),
    ("POST", re.compile(
        r"^/api/missions/(?P<mid>[^/]+)/experiments/(?P<exp>[^/]+)/replay$"),
     "replay"),
]


class RateLimiter:
    """Sliding-window counter per (bucket, client)."""

    def __init__(self) -> None:
        self._hits: dict[tuple, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, bucket: str, client: str, limit: int, window_s: float) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[(bucket, client)]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


class App:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.registry = M.Registry(settings)
        self.runtime = M.Runtime(settings, self.registry)
        self.limiter = RateLimiter()
        self.started_at = time.time()
        self.web_root = Path(settings.web_dir).resolve()

    # handlers: each returns (status, payload)
    def health(self, req, **_):
        return 200, {"ok": True, "version": __version__,
                     "can_execute": M.can_execute(),
                     "uptime_s": round(time.time() - self.started_at, 1),
                     "active_runs": self.runtime.active_count()}

    def meta(self, req, **_):
        return 200, M.meta_payload(self.settings)

    def evaluation(self, req, **_):
        return 200, M.evaluation_payload(self.settings)

    def list_missions(self, req, **_):
        out = []
        for ref in self.registry.examples() + self.registry.users():
            try:
                out.append(M.summary_of(self.runtime.snapshot(ref)))
            except M.ApiError:
                continue          # an unreadable mission is skipped, not fatal
        out.sort(key=lambda m: (m["source"] != "user", -(m["created_at"] or 0)))
        return 200, {"missions": out}

    def create_mission(self, req, **_):
        self._require_token(req)
        if not self.limiter.allow("create", req.client, self.settings.create_limit,
                                  self.settings.create_window_s):
            raise M.ApiError(429, "too many missions created from this address; "
                                  "try again in a few minutes")
        body = req.json_body()
        ref = self.runtime.create(body)
        run = None
        if body.get("autostart"):
            try:
                self.runtime.start(ref)
                run = "started"
            except M.ApiError as e:
                run = e.message
        snap = self.runtime.snapshot(ref)
        snap["autostart"] = run
        return 201, snap

    def get_mission(self, req, mid):
        return 200, self.runtime.snapshot(self.registry.get(mid))

    def events(self, req, mid):
        ref = self.registry.get(mid)
        q = req.query
        try:
            after = int(q.get("after", ["0"])[0])
            limit = max(1, min(1000, int(q.get("limit", ["500"])[0])))
        except ValueError:
            raise M.ApiError(400, "after/limit must be integers")
        data = M.read_events(ref.root, after, limit)
        data["run"] = self.runtime.run_info(ref.id)
        return 200, data

    def results(self, req, mid):
        ref = self.registry.get(mid)
        self._not_while_running(ref)
        return 200, {"results": M.experiment_results(self.runtime.load(ref))}

    def dossier(self, req, mid):
        ref = self.registry.get(mid)
        return 200, {"markdown": self.runtime.dossier(ref)}

    def experiment(self, req, mid, exp):
        ref = self.registry.get(mid)
        self._not_while_running(ref)
        return 200, M.experiment_detail(self.runtime.load(ref), exp)

    def run(self, req, mid):
        self._require_token(req)
        ref = self.registry.get(mid)
        body = req.json_body(optional=True)
        steps = body.get("steps")
        if steps is not None:
            if not isinstance(steps, int) or not 1 <= steps <= 1000:
                raise M.ApiError(400, "steps must be an integer 1..1000")
        self.runtime.start(ref, max_steps=steps)
        return 202, {"started": True, "run": self.runtime.run_info(ref.id)}

    def pause(self, req, mid):
        self._require_token(req)
        return 202, self.runtime.request_stop(self.registry.get(mid), "pause")

    def cancel(self, req, mid):
        self._require_token(req)
        return 202, self.runtime.request_stop(self.registry.get(mid), "cancel")

    def verify(self, req, mid):
        return 200, self.runtime.verify(self.registry.get(mid))

    def replay(self, req, mid, exp):
        self._require_token(req)
        if not self.limiter.allow("replay", req.client, self.settings.replay_limit,
                                  self.settings.replay_window_s):
            raise M.ApiError(429, "too many replays from this address; try "
                                  "again in a few minutes")
        return 200, self.runtime.replay(self.registry.get(mid), exp)

    # guards
    def _require_token(self, req) -> None:
        token = self.settings.token
        if not token:
            return
        header = req.headers.get("Authorization", "")
        given = header[7:].strip() if header.lower().startswith("bearer ") else ""
        if not given or not hmac.compare_digest(given.encode(), token.encode()):
            raise M.ApiError(401, "this server requires an access key for changes")

    def _not_while_running(self, ref) -> None:
        h = self.runtime.handle(ref.id)
        if h is not None and h.alive:
            raise M.ApiError(409, "available once the run pauses or completes",
                             retry=True)

    # static files
    def static_path(self, path: str) -> Path | None:
        if path in ("", "/"):
            rel = "index.html"
        elif re.match(r"^/missions/[a-z0-9][a-z0-9_-]{0,95}/?$", path):
            rel = "mission.html"
        else:
            rel = path.lstrip("/")
        if any(part.startswith(".") for part in rel.split("/")):
            return None
        target = (self.web_root / rel).resolve()
        try:
            target.relative_to(self.web_root)
        except ValueError:
            return None
        if target.is_dir():
            target = target / "index.html"
        return target if target.is_file() else None


class Request:
    def __init__(self, handler: "Handler") -> None:
        self.handler = handler
        self.headers = handler.headers
        parts = urlsplit(handler.path)
        self.path = parts.path
        self.query = parse_qs(parts.query)
        self.client = handler.client_key()
        self._body = None
        self.too_large = False
        # Always consume the body, even for endpoints that ignore it: bytes
        # left on a keep-alive connection would be parsed as the next request.
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self.too_large = length > MAX_BODY
            self.raw = b""
            handler.close_connection = True     # cannot resync the stream
        else:
            self.raw = handler.rfile.read(length) if length else b""

    def json_body(self, optional: bool = False) -> dict:
        if self._body is not None:
            return self._body
        if self.too_large:
            raise M.ApiError(413, "request body too large")
        raw = self.raw
        if not raw:
            if optional:
                self._body = {}
                return self._body
            raise M.ApiError(400, "expected a JSON body")
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise M.ApiError(400, "body is not valid JSON")
        if not isinstance(data, dict):
            raise M.ApiError(400, "expected a JSON object")
        self._body = data
        return data


class Handler(BaseHTTPRequestHandler):
    server_version = f"atheryn/{__version__}"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    app: App = None  # set by create_server

    # plumbing
    def client_key(self) -> str:
        if self.app.settings.trust_proxy:
            fwd = self.headers.get("X-Forwarded-For", "")
            if fwd:
                return fwd.split(",")[0].strip()[:64]
        return self.client_address[0]

    def log_message(self, fmt, *args) -> None:  # concise; never logs bodies
        sys.stderr.write(f"{self.log_date_time_string()} {self.client_key()} "
                         f"{fmt % args}\n")

    def _cors(self) -> dict:
        origin = self.headers.get("Origin", "")
        if origin and origin in self.app.settings.cors_origins:
            return {"Access-Control-Allow-Origin": origin, "Vary": "Origin",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Max-Age": "600"}
        return {}

    def _send(self, status: int, body: bytes, ctype: str,
              extra: dict | None = None, cache: str = "no-store") -> None:
        headers = {"Content-Type": ctype, "Cache-Control": cache,
                   "X-Content-Type-Options": "nosniff",
                   "Referrer-Policy": "strict-origin-when-cross-origin",
                   "X-Frame-Options": "DENY",
                   "Content-Security-Policy": CSP}
        headers.update(self._cors())
        headers.update(extra or {})
        if (len(body) >= GZIP_MIN and ctype.startswith(GZIP_TYPES)
                and "gzip" in self.headers.get("Accept-Encoding", "")):
            body = gzip.compress(body, compresslevel=6)
            headers["Content-Encoding"] = "gzip"
            headers["Vary"] = (headers.get("Vary", "") + ", Accept-Encoding").strip(", ")
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, payload: dict, extra: dict | None = None) -> None:
        body = json.dumps(payload, default=str, separators=(",", ":")).encode()
        self._send(status, body, "application/json; charset=utf-8", extra)

    def _error(self, status: int, message: str, **extra) -> None:
        payload = {"error": message, "status": status}
        payload.update(extra)
        self._json(status, payload)

    # dispatch
    def _dispatch(self, method: str) -> None:
        try:
            req = Request(self)
        except Exception:  # noqa: BLE001
            self.close_connection = True
            self._error(400, "bad request")
            return
        if req.too_large:
            self._error(413, "request body too large")
            return
        if req.path.startswith("/api/"):
            for verb, pattern, name in ROUTES:
                m = pattern.match(req.path)
                if not m:
                    continue
                if verb != method and not (verb == "GET" and method == "HEAD"):
                    continue
                try:
                    status, payload = getattr(self.app, name)(req, **m.groupdict())
                except M.ApiError as e:
                    self._error(e.status, e.message, **e.extra)
                except Exception as e:  # noqa: BLE001 - never leak a traceback
                    sys.stderr.write(f"internal error on {req.path}: "
                                     f"{type(e).__name__}: {e}\n")
                    self._error(500, "internal server error")
                else:
                    self._json(status, payload)
                return
            if any(p.match(req.path) for _, p, _ in ROUTES):
                self._error(405, "method not allowed")
            else:
                self._error(404, "no such endpoint")
            return
        if method not in ("GET", "HEAD"):
            self._error(405, "method not allowed")
            return
        target = self.app.static_path(req.path)
        if target is None:
            page = self.app.static_path("/404.html")
            body = page.read_bytes() if page else b"Not found"
            self._send(404, body, "text/html; charset=utf-8")
            return
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",
                                                  "image/svg+xml"):
            ctype += "; charset=utf-8"
        # Unversioned asset URLs: always revalidate, answer 304 when unchanged,
        # so a deploy is visible immediately without a cache-busting build step.
        mtime = int(target.stat().st_mtime)
        last_modified = formatdate(mtime, usegmt=True)
        since = self.headers.get("If-Modified-Since")
        if since:
            try:
                if int(parsedate_to_datetime(since).timestamp()) >= mtime:
                    self.send_response(304)
                    self.send_header("Last-Modified", last_modified)
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
            except (TypeError, ValueError, IndexError, OverflowError):
                pass
        self._send(200, target.read_bytes(), ctype, cache="no-cache",
                   extra={"Last-Modified": last_modified})

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_HEAD(self) -> None:
        self._dispatch("HEAD")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def do_OPTIONS(self) -> None:
        cors = self._cors()
        self.send_response(204 if cors else 403)
        for k, v in cors.items():
            self.send_header(k, v)
        self.send_header("Content-Length", "0")
        self.end_headers()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def create_server(settings: Settings | None = None) -> tuple[Server, App]:
    settings = settings or Settings.from_env()
    app = App(settings)
    handler = type("BoundHandler", (Handler,), {"app": app})
    server = Server((settings.host, settings.port), handler)
    return server, app
