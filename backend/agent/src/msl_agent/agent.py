"""Strands Agent orchestration and its RLS-aware deterministic read tool."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from strands import Agent, tool
from strands.models import BedrockModel

from .config import Settings
from .repository import ScopedReadRepository
from .schemas import Citation, Identity, Invocation


class MslAgent:
    def __init__(self, settings: Settings, repository: ScopedReadRepository) -> None:
        self._settings = settings
        self._repository = repository

    def _strands_agent(self, identity: Identity) -> Agent:
        @tool
        def read_scoped_call_metric() -> str:
            """Read the caller's RLS-scoped call count and source record ids."""
            fact = self._repository.metric_for_question(identity, "")
            return json.dumps(
                {
                    "metric": fact.metric,
                    "value": fact.value,
                    "record_ids": [citation.record_id for citation in fact.citations],
                }
            )

        model = BedrockModel(
            model_id=self._settings.bedrock_model_id,
            endpoint_url=self._settings.bedrock_endpoint,
            region_name=self._settings.aws_region,
            streaming=True,  # BedrockModel uses ConverseStream when this is true.
            max_tokens=500,
        )
        return Agent(
            model=model,
            tools=[read_scoped_call_metric],
            system_prompt=(
                "You are the MSL Agent. Use only supplied deterministic facts for numbers. "
                "Never invent sources; concise answers are preferred."
            ),
        )

    async def stream(self, invocation: Invocation) -> tuple[AsyncIterator[str], tuple[Citation, ...]]:
        latest_question = next(
            (message.content for message in reversed(invocation.messages) if message.role == "user"), ""
        )
        fact = self._repository.metric_for_question(invocation.identity, latest_question)
        prompt = (
            f"Authoritative deterministic fact: {fact.metric}={fact.value}; "
            f"record ids={','.join(citation.record_id for citation in fact.citations)}.\n"
            f"User question: {latest_question}"
        )

        async def chunks() -> AsyncIterator[str]:
            # Strands BedrockModel -> boto3 ConverseStream -> floci Bedrock Runtime.
            agent = self._strands_agent(invocation.identity)
            async for event in agent.stream_async(prompt):
                if isinstance(event, dict) and isinstance(event.get("data"), str):
                    yield event["data"]

        return chunks(), fact.citations


class StubMslAgent:
    """Deterministic test double for floci's no-key stub mode."""

    def __init__(self, repository: ScopedReadRepository) -> None:
        self._repository = repository

    async def stream(self, invocation: Invocation) -> tuple[AsyncIterator[str], tuple[Citation, ...]]:
        fact = self._repository.metric_for_question(invocation.identity, "")

        async def chunks() -> AsyncIterator[str]:
            yield "The local Bedrock stub is active. "
            yield f"Your deterministic {fact.metric.replace('_', ' ')} is {fact.value}."

        return chunks(), fact.citations
