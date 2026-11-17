"""Request and event payload types shared by the runtime modules."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class SummaryTask(BaseModel):
    """A leadership summary to write for an Executive (docs/adr/0013). The BE Lambda computes every figure.

    The facts and evidence are already small-group suppressed and aggregate-only; the agent reads no source.
    """

    type: Literal["leadership_summary"]
    summary_id: str = Field(pattern=r"^ls-[0-9]{14}-[0-9a-f]{8}$")
    title: str = Field(default="", max_length=200)
    from_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    to_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    scope_label: str = Field(default="", max_length=400)
    scope_territory_ids: list[str] = Field(default_factory=list, max_length=200)
    access_level: Literal["AGGREGATE_ONLY", "RECORD_DRILLDOWN"] = "AGGREGATE_ONLY"
    data_through: str | None = None
    definition_version: str = Field(default="", max_length=64)
    regenerates_summary_id: str | None = Field(default=None, max_length=64)
    key_figures: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    facts: list[dict[str, Any]] = Field(default_factory=list, max_length=60)
    sample_limitations: list[str] = Field(default_factory=list, max_length=12)
    definitions: list[dict[str, Any]] = Field(default_factory=list, max_length=12)
    disclosure: dict[str, Any] = Field(default_factory=dict)
    evidence: list[dict[str, Any]] = Field(default_factory=list, max_length=120)


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


def _no_controls(value: str) -> str:
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("control characters are not allowed")
    return value.strip()


class PageFigure(BaseModel):
    """One headline figure as the page printed it. Shown text copied by the browser: never a fact (docs/adr/0019)."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9_.:-]{1,64}$")
    label: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=40)
    definition: str | None = Field(default=None, max_length=160)

    @field_validator("label", "value", "definition")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return _no_controls(value) if isinstance(value, str) else value


class PageFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    to_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    territory_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_.:-]{1,64}$")
    question_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_.:-]{1,64}$")
    molecule: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.:()/+-]{0,63}$")
    landscape: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.:()/+-]{0,63}$")
    study: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.:()/+-]{0,63}$")
    survey: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.:()/+-]{0,63}$")
    theme: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.:()/+-]{0,63}$")


class PageContext(BaseModel):
    """What the person sees on the page the chat was opened from: its name, filters and headline figures.

    Set by the BE Lambda after validation. Readable context only: it tells the agent which number a question is
    about. It is never authority (every tool still reads under the caller's row-level security), the persona is the
    verified identity's, and the figures are unverified display text the agent must never repeat as facts.
    """

    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, max_length=80)
    filters: PageFilters | None = None
    figures: list[PageFigure] = Field(default_factory=list, max_length=12)

    @field_validator("label")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return _no_controls(value) if isinstance(value, str) else value


class A2uiAction(BaseModel):
    """An A2UI v1.0 ``action`` from a surface the agent sent earlier (docs/adr/0017), relayed by the BE Lambda.

    Untrusted browser input: the shape is bounded here and every value is validated against closed lists in
    ``a2ui.parse_refine_action`` before it can choose a query. It grants nothing a typed question would not.
    """

    name: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
    surface_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,96}$")
    source_component_id: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
    timestamp: str = Field(max_length=40)
    context: dict[str, Any] = Field(default_factory=dict, max_length=12)


class MemoryItem(BaseModel):
    """One remembered preference (docs/adr/0022): how the person likes to work, never a data fact."""

    text: str = Field(min_length=1, max_length=160)
    category: Literal["FORMAT", "LENGTH", "DATE_RANGE", "FOCUS", "OTHER"]


class WriteApproval(BaseModel):
    """A decision for the interrupt recorded by a preceding chat run."""

    interrupted_run_id: str = Field(min_length=8, max_length=64)
    approved: bool
    metadata: dict[str, Any] = Field(default_factory=dict, max_length=8)
    values: dict[str, Any] = Field(default_factory=dict, max_length=8)


class Invocation(BaseModel):
    """AgentCore Runtime input (foundation-contract.md) plus the run id the BE streams events under."""

    identity: Identity
    thread_id: str = Field(min_length=1, max_length=128)
    run_id: str | None = Field(default=None, max_length=128)
    messages: list[Message] = Field(min_length=1, max_length=40)
    #: Present for work other than a chat answer: a pre-call brief or a leadership summary.
    task: Annotated[BriefTask | SummaryTask, Field(discriminator="type")] | None = None
    context: AgentContext | None = None
    #: Present when the question is a user action on an A2UI surface (the Adjust this answer form).
    a2ui_action: A2uiAction | None = None
    #: What the person sees on the page the chat was opened from (docs/adr/0019): readable context, never authority.
    page: PageContext | None = None
    #: Present only for a verified, owner-scoped AppSync resume of a write interrupt.
    write_approval: WriteApproval | None = None
    #: The person's remembered preferences, read by the BE for this run (docs/adr/0022). The agent checks them again.
    memory: list[MemoryItem] = Field(default_factory=list, max_length=30)
    #: Keys of the preference suggestions the person dismissed (a hash, never the text) and whether this conversation was
    #: already offered one: both read by the BE, so the agent offers at most one new suggestion per conversation (ADR 0023).
    memory_dismissed: list[Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")]] = Field(default_factory=list, max_length=50)
    memory_offered: bool = False

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
    #: ``aggregate`` cites a set of responses by its filters and size (Executive, aggregate-only); the UI shows it
    #: inline and cannot open it as a record. ``record`` names one source record.
    kind: Literal["record", "aggregate"] = "record"
    detail: str | None = None


class Fact(BaseModel):
    """A number computed by a deterministic SQL query under RLS. The model never produces these."""

    fact_id: str
    label: str
    value: int
    unit: str
    period: str
    scope: str
    citation_ids: list[str] = Field(default_factory=list)
