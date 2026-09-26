"""Chart HTML for sandboxed iframes, served with its own strict CSP."""

from typing import Annotated, Final

from fastapi import APIRouter, Header, Response
from fastapi.responses import HTMLResponse

from remi.api.deps import ConfigDep, UowFactoryDep
from remi.api.endpoints._params import AssetId
from remi.api.errors import error_responses
from remi.api.middleware import CHART_CSP
from remi.services import chart_store

CHART_HEADERS: Final = {
    "Content-Security-Policy": CHART_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    # Revalidate each time (cheap: the ETag is the content hash) so a deleted chart stops
    # showing at once.
    "Cache-Control": "private, no-cache",
}

# The route's response class is HTML, so errors reference the JSON envelope explicitly (a
# ``model`` entry would be documented as text/html).
_JSON_ERRORS = {
    status: {
        "description": entry["description"],
        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorOut"}}},
    }
    for status, entry in error_responses(404, 422).items()
}

router = APIRouter(tags=["charts"])


@router.get(
    "/charts/{assetId}",
    response_class=HTMLResponse,
    summary='An uploaded chart\'s HTML (for <iframe sandbox="allow-scripts" src=…>)',
    responses={
        200: {
            "description": "The chart HTML, with `Content-Security-Policy: "
            "app.api.middleware.CHART_CSP` (sandboxed, no network).",
            "content": {"text/html": {"schema": {"type": "string"}}},
        },
        **_JSON_ERRORS,
    },
)
def get_chart_content(
    asset_id: AssetId,
    uow_factory: UowFactoryDep,
    config: ConfigDep,
    if_none_match: Annotated[str | None, Header(include_in_schema=False)] = None,
) -> Response:
    content = chart_store.read_chart(uow_factory, config.data_dir, asset_id)
    headers = {**CHART_HEADERS, "ETag": content.etag}
    if if_none_match is not None and content.etag in {t.strip() for t in if_none_match.split(",")}:
        return Response(status_code=304, headers=headers)
    return HTMLResponse(content.body, headers=headers)
