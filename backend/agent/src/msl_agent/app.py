"""AgentCore Runtime HTTP contract: ``GET /ping`` and ``POST /invocations`` (an SSE stream of AG-UI events)."""

from __future__ import annotations

from collections.abc import AsyncIterator

from a2g_logging import configure, correlation
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from . import ag_ui
from .agent import MslAgent
from .config import Settings
from .repository import ScopedReadRepository, repository_for
from .schemas import Invocation
from .writes import ConversationWriteTool, DynamoConversationWriter, NullConversationWriter

configure(service="msl-agent")


def writer_for(settings: Settings) -> ConversationWriteTool:
    if settings.fe_write_role_arn and settings.fe_chat_table:
        return DynamoConversationWriter(
            role_arn=settings.fe_write_role_arn, table=settings.fe_chat_table, region=settings.aws_region
        )
    return NullConversationWriter()


def create_app(
    settings: Settings | None = None,
    *,
    repository: ScopedReadRepository | None = None,
    writer: ConversationWriteTool | None = None,
    runtime: MslAgent | None = None,
) -> FastAPI:
    resolved = settings or Settings.from_environment()
    agent = runtime or MslAgent(
        resolved, repository or repository_for(resolved.database_url), writer or writer_for(resolved)
    )
    app = FastAPI(title="MSL Agent Runtime", version="0.2.0")

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/invocations")
    async def invoke(invocation: Invocation) -> StreamingResponse:
        async def stream() -> AsyncIterator[bytes]:
            with correlation(invocation.identity.correlation_id):
                async for event in agent.run(invocation):
                    yield ag_ui.sse(event)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()
