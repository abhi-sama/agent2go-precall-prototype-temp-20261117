"""Request and event payload types shared by the runtime modules."""

from __future__ import annotations

from typing import Any, Literal

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


class BriefTask(BaseModel):
    """A pre-call brief to write (docs/adr/0009). The BE Lambda gathers the evidence under RLS and hands it over.

    Everything the model may cite is in this payload; the agent reads no other source for a brief.
    """

    type: Literal["pre_call_brief"]
    brief_id: str = Field(pattern=r"^br-[0-9]{14}-[0-9a-f]{8}$")
    hcp_id: str = Field(min_length=1, max_length=128)
    objective: str = Field(min_length=1, max_length=600)
    regenerates_brief_id: str | None = Field(default=None, max_length=64)
    scope_label: str = Field(default="", max_length=400)
    scope_territory_ids: list[str] = Field(default_factory=list, max_length=200)
    data_through: str | None = None
    fingerprint: dict[str, Any] = Field(default_factory=dict)
    calls: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    responses: list[dict[str, Any]] = Field(default_factory=list, max_length=60)
    follow_ups: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    facts: list[dict[str, Any]] = Field(default_factory=list, max_length=12)
    missing: list[dict[str, str]] = Field(default_factory=list, max_length=20)
    evidence: list[dict[str, Any]] = Field(default_factory=list, max_length=120)
    last_interaction_date: str | None = None


class AgentContext(BaseModel):
    """What the user was looking at when they opened the chat (set by the BE after validation).

    It supplies defaults for tool arguments and picks the task. It is never authority: every tool still
    reads under the caller's row-level security, so a context naming another territory reads nothing.
    """

    view: str | None = Field(default=None, max_length=40, pattern=r"^[a-z0-9-]+$")
    territory_id: str | None = Field(default=None, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    question_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    from_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    to_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    intent: Literal["FREE", "TERRITORY_SUMMARY"] = "FREE"


class Invocation(BaseModel):
    """AgentCore Runtime input (foundation-contract.md) plus the run id the BE streams events under."""

    identity: Identity
    thread_id: str = Field(min_length=1, max_length=128)
    run_id: str | None = Field(default=None, max_length=128)
    messages: list[Message] = Field(min_length=1, max_length=40)
    #: Present for work other than a chat answer; today only the pre-call brief.
    task: BriefTask | None = None
    context: AgentContext | None = None

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
