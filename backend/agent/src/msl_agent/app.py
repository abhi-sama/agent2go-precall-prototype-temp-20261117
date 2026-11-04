from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from .ag_ui import ag_ui_events
from .agent import MslAgent, StubMslAgent
from .config import Settings
from .logging import audit
from .repository import repository_for
from .schemas import Invocation


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_environment()
    repository = repository_for(resolved_settings.database_url)
    runtime = (
        StubMslAgent(repository)
        if resolved_settings.use_stub_model
        else MslAgent(resolved_settings, repository)
    )
    app = FastAPI(title="MSL Agent Runtime", version="0.1.0")

    @app.get("/ping")
    async def ping() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/invocations")
    async def invoke(invocation: Invocation) -> StreamingResponse:
        audit(
            "invocation_started",
            correlation_id=invocation.identity.correlation_id,
            thread_id=invocation.thread_id,
            event_count=len(invocation.messages),
            mode="test-stub" if resolved_settings.use_stub_model else resolved_settings.floci_backend,
        )
        chunks, citations = await runtime.stream(invocation)
        return StreamingResponse(
            ag_ui_events(thread_id=invocation.thread_id, chunks=chunks, citations=citations),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()
