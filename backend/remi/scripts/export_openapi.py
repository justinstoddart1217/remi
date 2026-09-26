"""Write the OpenAPI contract as stable, sorted JSON.

Usage: ``python -m remi.scripts.export_openapi [OUT]`` (default
``contracts/remi-openapi.json`` at the repository root). ``make openapi`` then generates
``frontend/remi/src/api/schema.d.ts`` from it (``npm run gen:api``).
"""

import json
import sys
from pathlib import Path

from remi.core.config import RemiConfig
from remi.core.paths import repo_root
from remi.main import create_app


def main(argv: list[str]) -> int:
    out = Path(argv[1]) if len(argv) > 1 else repo_root() / "contracts" / "remi-openapi.json"
    spec = create_app(RemiConfig(env="test", open_browser=False)).openapi()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
