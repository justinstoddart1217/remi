"""Textbook: sections, pages, block autosave, chart uploads, home and search."""

import re
from collections.abc import Callable, Coroutine
from typing import Annotated, Any, Final

from fastapi import APIRouter, File, Query, Request, Response, UploadFile, status
from fastapi.routing import APIRoute
from starlette.types import Message

from app.api.deps import ConfigDep, UowFactoryDep, get_config
from app.api.endpoints._params import AssetId, PageId, SectionId
from app.api.errors import error_responses
from app.schemas.base import OrderPut
from app.schemas.textbook import (
    BlocksPut,
    ChartUploadOut,
    PageCreate,
    PageCreatedOut,
    PageDeletedOut,
    PageOut,
    PagePatch,
    PageSavedOut,
    PageSummaryOut,
    SectionCreate,
    SectionOut,
    SectionPatch,
    TextbookHomeOut,
    TextbookSearchOut,
    TextbookTreeOut,
)
from app.services import chart_store
from app.services import textbook as textbook_service

router = APIRouter(tags=["textbook"])

MULTIPART_OVERHEAD: Final = 64 * 1024
"""Room for the multipart boundary and part headers around the chart file itself."""
_SNIFF_BYTES: Final = 16 * 1024
_FILENAME: Final = re.compile(rb'filename="([^"\r\n]*)"')


class _BoundedUploadRoute(APIRoute):
    """Reads the upload's body before FastAPI parses the form.

    A body over ``chart_max_bytes`` plus :data:`MULTIPART_OVERHEAD` is read to the end and
    thrown away as it arrives (no memory, no temp file; reading it all keeps the connection
    clean so the browser sees the answer), then answered 413 ``PAYLOAD_TOO_LARGE``. A body
    within the bound is handed on, and the service checks the file's exact size.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def bounded(request: Request) -> Response:
            max_bytes = get_config(request).chart_max_bytes
            limit = max_bytes + MULTIPART_OVERHEAD
            kept: list[bytes] = []
            head = b""
            size = 0
            async for chunk in request.stream():
                if len(head) < _SNIFF_BYTES:
                    head += chunk[: _SNIFF_BYTES - len(head)]
                size += len(chunk)
                if size <= limit:
                    kept.append(chunk)
                else:
                    kept.clear()
            if size > limit:
                match = _FILENAME.search(head)
                raw = match.group(1).decode("utf-8", "replace") if match else None
                raise chart_store.too_large(chart_store.clean_name(raw), max_bytes)

            body = b"".join(kept)
            replayed = False

            async def replay() -> Message:
                nonlocal replayed
                if replayed:
                    return await request.receive()
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}

            return await handler(Request(request.scope, replay))

        return bounded


@router.get("/textbook", summary="Every section and page (the sidebar tree)")
def get_textbook_tree(uow_factory: UowFactoryDep) -> TextbookTreeOut:
    return textbook_service.get_tree(uow_factory)


@router.get("/textbook/home", summary="Textbook home: counts, recent pages, charts, sections")
def get_textbook_home(uow_factory: UowFactoryDep) -> TextbookHomeOut:
    return textbook_service.get_home(uow_factory)


@router.get(
    "/textbook/search",
    summary="Find pages by title or block text",
    responses=error_responses(422),
)
def search_textbook(
    q: Annotated[str, Query(min_length=1, max_length=200)], uow_factory: UowFactoryDep
) -> TextbookSearchOut:
    return textbook_service.search(uow_factory, q)


@router.post(
    "/textbook/sections",
    status_code=status.HTTP_201_CREATED,
    summary="Add a section",
    responses=error_responses(422),
)
def create_section(body: SectionCreate, uow_factory: UowFactoryDep) -> SectionOut:
    return textbook_service.create_section(uow_factory, body)


@router.put(
    "/textbook/sections/order",
    summary="Reorder the sections",
    responses=error_responses(422),
)
def reorder_sections(body: OrderPut, uow_factory: UowFactoryDep) -> TextbookTreeOut:
    return textbook_service.reorder_sections(uow_factory, body)


@router.patch(
    "/textbook/sections/{sectionId}",
    summary="Rename, recolour or collapse a section",
    responses=error_responses(404, 422),
)
def update_section(
    section_id: SectionId, body: SectionPatch, uow_factory: UowFactoryDep
) -> SectionOut:
    """A blank ``label`` on an empty, unnamed section (not the last one) deletes it, as
    committing an empty name does in the design; the answer is then the section as it was.
    A blank ``label`` on a named section leaves the name unchanged."""
    return textbook_service.update_section(uow_factory, section_id, body)


@router.delete(
    "/textbook/sections/{sectionId}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete an empty section (not the last one)",
    responses=error_responses(404, 409, 422),
)
def delete_section(section_id: SectionId, uow_factory: UowFactoryDep) -> None:
    """409 ``SECTION_NOT_EMPTY`` or ``LAST_SECTION``."""
    textbook_service.delete_section(uow_factory, section_id)


@router.post(
    "/textbook/pages",
    status_code=status.HTTP_201_CREATED,
    summary="Create a page or sub-page",
    responses=error_responses(404, 409, 422),
)
def create_page(body: PageCreate, uow_factory: UowFactoryDep, config: ConfigDep) -> PageCreatedOut:
    return textbook_service.create_page(uow_factory, config.data_dir, body)


@router.get(
    "/textbook/pages/{pageId}",
    summary="A page with its blocks",
    responses=error_responses(404, 422),
)
def get_page(page_id: PageId, uow_factory: UowFactoryDep) -> PageOut:
    return textbook_service.get_page(uow_factory, page_id)


@router.patch(
    "/textbook/pages/{pageId}",
    summary="Rename a page",
    responses=error_responses(404, 422),
)
def update_page(page_id: PageId, body: PagePatch, uow_factory: UowFactoryDep) -> PageSummaryOut:
    return textbook_service.rename_page(uow_factory, page_id, body)


@router.put(
    "/textbook/pages/{pageId}/blocks",
    summary="Autosave a page's blocks (optimistic lock on baseVersion)",
    responses=error_responses(404, 409, 422),
)
def put_page_blocks(
    page_id: PageId, body: BlocksPut, uow_factory: UowFactoryDep, config: ConfigDep
) -> PageSavedOut:
    """409 ``VERSION_CONFLICT`` when ``baseVersion`` is stale: refetch the page."""
    return textbook_service.save_blocks(uow_factory, config.data_dir, page_id, body)


@router.delete(
    "/textbook/pages/{pageId}",
    summary="Delete a page and everything inside it",
    responses=error_responses(404, 422),
)
def delete_page(page_id: PageId, uow_factory: UowFactoryDep, config: ConfigDep) -> PageDeletedOut:
    return textbook_service.delete_page(uow_factory, config.data_dir, page_id)


def upload_chart(
    file: Annotated[UploadFile, File(description="The chart's HTML file.")],
    uow_factory: UowFactoryDep,
    config: ConfigDep,
) -> ChartUploadOut:
    """Deduplicated by content hash. Charts render in a sandboxed iframe from
    ``GET /api/charts/{assetId}``; unreferenced assets are garbage-collected."""
    # One byte over the limit is enough to know it is too large.
    body = file.file.read(config.chart_max_bytes + 1)
    return chart_store.upload_chart(
        uow_factory,
        config.data_dir,
        filename=file.filename,
        body=body,
        max_bytes=config.chart_max_bytes,
    )


router.add_api_route(
    "/textbook/charts",
    upload_chart,
    methods=["POST"],
    status_code=status.HTTP_201_CREATED,
    summary="Upload an HTML chart (.html/.htm, UTF-8, at most 4 MB)",
    responses=error_responses(413, 415, 422),
    route_class_override=_BoundedUploadRoute,
)


@router.delete(
    "/textbook/charts/{assetId}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete an unreferenced chart asset",
    responses=error_responses(404, 409, 422),
)
def delete_chart(asset_id: AssetId, uow_factory: UowFactoryDep, config: ConfigDep) -> None:
    """409 ``CONFLICT`` while a chart block still uses it. Unreferenced assets are also
    garbage-collected after each commit, so the editor never needs to call this."""
    chart_store.delete_chart(uow_factory, config.data_dir, asset_id)
