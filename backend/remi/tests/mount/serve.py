"""``make mounted``: Remi mounted in the stand-in APEX, on waitress, as APEX runs in production.

A rehearsal of the integration on this machine (docs/apex/IMPORT.md): open
http://localhost:8011/ for the stand-in APEX and http://localhost:8011/remi/ for Remi. Remi's
settings come from the environment, which the Makefile sets (REMI_PUBLIC_URL, REMI_DATA_DIR,
REMI_FRONTEND_DIST, REMI_ENV). The parity harness's mounted flows start it too.
"""

import argparse
import logging
from collections.abc import Sequence

from waitress import serve

from remi.mount import mount, status
from remi.tests.mount.fake_apex import create_fake_apex


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Serve Remi mounted in a stand-in APEX.")
    parser.add_argument("--port", type=int, default=8011, help="port (default 8011, as APEX dev)")
    args = parser.parse_args(argv)
    port: int = args.port
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    apex = create_fake_apex()
    # What APEX's server.py does (Flask's documented way to wrap its WSGI app).
    apex.wsgi_app = mount(apex.wsgi_app)  # pyright: ignore[reportAttributeAccessIssue]
    print(f"Stand-in APEX on http://localhost:{port}/  |  {status()}", flush=True)
    serve(apex, host="127.0.0.1", port=port, threads=8)


if __name__ == "__main__":  # pragma: no cover
    main()
