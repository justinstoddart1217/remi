"""A stand-in for APEX: a Flask app with APEX's PM health route and its SPA fallback.

The mount tests wrap it exactly as APEX's ``server.py`` will (``app.wsgi_app = mount(...)``),
and ``make mounted`` serves it on waitress, as APEX runs in production, to rehearse the
integration (docs/apex/IMPORT.md).
"""

from flask import Flask, Response, jsonify

APEX_HOME = (
    '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>APEX</title></head>'
    '<body><h1>APEX (stand-in)</h1><p><a href="/remi/">remi</a></p></body></html>'
)


def create_fake_apex() -> Flask:
    app = Flask("fake_apex")

    @app.get("/api/pm/health")
    def pm_health() -> Response:  # pyright: ignore[reportUnusedFunction]
        return jsonify(status="ok", app="apex")

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def spa(path: str) -> Response:  # pyright: ignore[reportUnusedFunction]
        return Response(APEX_HOME, mimetype="text/html")

    return app
