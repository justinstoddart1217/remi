"""Write the OpenAPI contract as stable, sorted JSON.

Usage, from ``backend/``: ``uv run python -m scripts.export_openapi [OUT]``
(default ``../contracts/openapi.json``). ``make openapi`` then generates
``frontend/src/api/schema.d.ts`` from it.
"""

import json
import sys
from pathlib import Path

from app.core.config import RemiConfig
from app.core.paths import repo_root
from app.main import create_app


def main(argv: list[str]) -> int:
    out = Path(argv[1]) if len(argv) > 1 else repo_root() / "contracts" / "openapi.json"
    spec = create_app(RemiConfig(env="test", open_browser=False)).openapi()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
