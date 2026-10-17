# Web interface and deployment

ATHERYN ships a web front end and an HTTP API on top of the unchanged engine.
Both are standard library only, like the engine.

```text
web/               static site: home page, mission control (vanilla JS, no build step)
atheryn_server/    HTTP API + static file server  (python -m atheryn_server)
Dockerfile         one image: engine + API + site
render.yaml        Render blueprint for that image
```

The server never changes how a mission is planned, executed or judged. It
creates and drives missions through the same public calls the CLI uses
(`ResearchState.create`, `ResearchController.step`, `state.save`) and reads
durable state back as JSON. Shipped missions in `examples/` are served
read-only.

## Run locally

```bash
python -m atheryn_server --port 8000      # then open http://127.0.0.1:8000
```

Experiments are confined with POSIX rlimits, so **new missions only run on
Linux or macOS**. On Windows the site still works for browsing the shipped
missions; the lab shows a notice instead of starting a mission.

## Deploy (Render, free plan)

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, choose the repository. `render.yaml` creates
   one Docker web service with a health check on `/api/health`.
3. Optional: set `ATHERYN_API_TOKEN` in the service's environment to require an
   access key for every change (reads stay public).

Any host that runs a Docker container on Linux works the same way (Railway,
Fly.io, Koyeb, a VPS): build the `Dockerfile`, expose `$PORT`. Static-only
hosts (Vercel, Netlify, GitHub Pages) cannot run the engine — it needs a
long-running Python process that spawns experiment subprocesses. You can still
host `web/` there and point it at an API elsewhere: set
`<meta name="atheryn-api" content="https://your-api.example">` in both HTML
files and list the site's origin in `ATHERYN_CORS_ORIGINS` (and widen the
`connect-src` directive of the CSP in `atheryn_server/app.py`).

**Persistence.** Missions created on the server live in `ATHERYN_RUNS_DIR`
(`/data/runs` in the image). On Render's free plan that filesystem is
ephemeral: created missions disappear on restart or redeploy, and the service
sleeps when idle. Attach a disk at `/data` (paid plans) to keep them.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8000` | bind address (the image uses `0.0.0.0`) |
| `ATHERYN_API_TOKEN` | unset | when set, every POST needs `Authorization: Bearer <token>` |
| `ATHERYN_RUNS_DIR` | `runs/web` | where missions created over HTTP are stored |
| `ATHERYN_MAX_CONCURRENT_RUNS` | `1` | missions (and replays) executing at once |
| `ATHERYN_MAX_USER_MISSIONS` | `40` | stored missions before creation is refused |
| `ATHERYN_MAX_EXPERIMENTS` | `12` | per-mission experiment cap |
| `ATHERYN_MAX_COMPUTE_MINUTES` | `5` | per-mission compute cap |
| `ATHERYN_ALLOWED_PROFILES` | `fast,graph_fast` | profiles the lab may request |
| `ATHERYN_CREATE_LIMIT` | `6` | missions per client address per 10 minutes |
| `ATHERYN_ALLOW_PROVIDER` | off | allow `brain=anthropic` (also needs `ANTHROPIC_API_KEY`) |
| `ATHERYN_TRUST_PROXY` | off (on in the image) | use `X-Forwarded-For` for rate limits |
| `ATHERYN_CORS_ORIGINS` | unset | comma-separated origins allowed to call the API |

## A public instance

Without a token, anyone who can reach the server can start missions. The caps
above keep that cheap: fast profiles only, small budgets, one mission
executing at a time, and a per-address creation limit. Every web-created
mission still carries a wall-time cap, so nothing runs unbounded. The engine's
own boundaries are unchanged: experiments run only code generated from audited
domain templates, under user-space limits — not kernel isolation (see
[`SECURITY.md`](SECURITY.md)). The image runs them as an unprivileged user.
URL ingestion and live LLM calls are not exposed over HTTP.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | liveness, version, whether experiments can execute |
| GET | `/api/meta` | domains, profiles, lifecycle, decisive rule, server limits |
| GET | `/api/evaluation` | the pre-registered flagship evaluation |
| GET | `/api/missions` | summaries of shipped and server missions |
| POST | `/api/missions` | create `{question, domain, profile?, max_experiments?, compute_minutes?, brain?, autostart?}` |
| GET | `/api/missions/<id>` | full mission snapshot (ledger, experiments, critic, decisions) |
| GET | `/api/missions/<id>/events?after=N` | append-only event log, paginated |
| GET | `/api/missions/<id>/results` | measurements per completed experiment |
| GET | `/api/missions/<id>/dossier` | the dossier as Markdown |
| GET | `/api/missions/<id>/experiments/<exp>` | record, spec, result, generated code, output |
| POST | `/api/missions/<id>/run` | run or resume `{steps?}`; one writer per mission |
| POST | `/api/missions/<id>/pause` | pause at the next checkpoint |
| POST | `/api/missions/<id>/cancel` | terminal cancellation with a recorded reason |
| POST | `/api/missions/<id>/verify` | `state.verify()` |
| POST | `/api/missions/<id>/experiments/<exp>/replay` | re-execute and compare, like `atheryn replay` |

Tests: `tests/test_web_api.py` (the full HTTP mission lifecycle runs on POSIX
only). CI additionally builds the image, boots it as the unprivileged user and
completes a mission over HTTP.
