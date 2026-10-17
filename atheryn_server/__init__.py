"""HTTP API and static web front end for ATHERYN.

This package sits *outside* the research core on purpose: the engine in
`atheryn/` knows nothing about HTTP, and nothing here changes how a mission
is planned, executed, analysed or judged. The server only

  * reads durable mission state and exposes it as JSON,
  * creates and drives missions through the same public API the CLI uses
    (`ResearchState.create`, `ResearchController.step`, `state.save`), and
  * serves the static site in `web/`.

Standard library only, like the engine itself.

    python -m atheryn_server --port 8000
"""
__all__ = ["create_server", "Settings"]

from .settings import Settings          # noqa: E402
from .app import create_server          # noqa: E402
