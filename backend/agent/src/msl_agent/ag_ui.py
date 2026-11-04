from __future__ import annotations

import json
from collections.abc import AsyncIterator
from uuid import uuid4

from .schemas import Citation


def sse(event: dict[str, object]) -> bytes:
    return f"data: {json.dumps(event, separators=(',', ':'))}\n\n".encode()


async def ag_ui_events(
    *, thread_id: str, chunks: AsyncIterator[str], citations: tuple[Citation, ...]
) -> AsyncIterator[bytes]:
    run_id = str(uuid4())
    message_id = str(uuid4())
    yield sse({"type": "RUN_STARTED", "threadId": thread_id, "runId": run_id})
    yield sse({"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": "assistant"})
    async for chunk in chunks:
        if chunk:
            yield sse({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": chunk})
    yield sse({"type": "TEXT_MESSAGE_END", "messageId": message_id})
    yield sse(
        {
            "type": "CUSTOM",
            "name": "record_citations",
            "value": [citation.model_dump() for citation in citations],
        }
    )
    yield sse({"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id})
