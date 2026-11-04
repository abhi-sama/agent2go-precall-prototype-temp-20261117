"""Request and event payload types shared by the runtime modules."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Identity(BaseModel):
    """The verified caller, handed over by the BE Lambda (the agent trusts no one else)."""

    user_id: str = Field(min_length=1, max_length=128)
    persona: str = Field(min_length=1, max_length=32)
    full_name: str = Field(default="", max_length=200)
    email: str = Field(default="", max_length=320)
    correlation_id: str = Field(min_length=1, max_length=128)


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4_000)


class Invocation(BaseModel):
    """AgentCore Runtime input (foundation-contract.md) plus the run id the BE streams events under."""

    identity: Identity
    thread_id: str = Field(min_length=1, max_length=128)
    run_id: str | None = Field(default=None, max_length=128)
    messages: list[Message] = Field(min_length=1, max_length=40)

    @field_validator("messages")
    @classmethod
    def _ends_with_user_question(cls, messages: list[Message]) -> list[Message]:
        if messages[-1].role != "user":
            raise ValueError("the last message must be the user's question")
        return messages

    @property
    def question(self) -> str:
        return self.messages[-1].content


class Citation(BaseModel):
    """A source record the answer rests on; the UI opens it through the `chatCitation` query."""

    record_id: str
    dataset: Literal["call_activity", "hcp_raw_insights"]
    label: str


class Fact(BaseModel):
    """A number computed by a deterministic SQL query under RLS. The model never produces these."""

    fact_id: str
    label: str
    value: int
    unit: str
    period: str
    scope: str
    citation_ids: list[str] = Field(default_factory=list)
