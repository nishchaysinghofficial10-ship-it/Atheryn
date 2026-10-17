"""python -m atheryn_server [--host H] [--port P]"""
from __future__ import annotations

import argparse
import signal
import sys
import threading

from .app import create_server
from .missions import can_execute
from .settings import Settings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="atheryn_server",
                                 description="ATHERYN web API and site")
    ap.add_argument("--host", default=None, help="bind address (env HOST)")
    ap.add_argument("--port", type=int, default=None, help="port (env PORT)")
    args = ap.parse_args(argv)

    overrides = {}
    if args.host:
        overrides["host"] = args.host
    if args.port:
        overrides["port"] = args.port
    settings = Settings.from_env(**overrides)
    server, app = create_server(settings)

    def stop(*_):
        # Pause running missions at their next checkpoint, then stop serving.
        threading.Thread(target=lambda: (app.runtime.shutdown(), server.shutdown()),
                         daemon=True).start()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, stop)
        except (ValueError, OSError):
            pass

    print(f"ATHERYN web on http://{settings.host}:{settings.port}  "
          f"(missions: {settings.runs_dir}; experiments "
          f"{'enabled' if can_execute() else 'DISABLED: POSIX required'}; "
          f"writes {'need a token' if settings.token else 'open'})",
          file=sys.stderr, flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
