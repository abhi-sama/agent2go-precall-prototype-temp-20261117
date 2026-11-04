"""Row sets: a description of the exact rows behind a number the agent computed (docs/adr/0015).

A tool that returns a count, a share or a chart also records a *row set*: the kind of row (calls, HCPs or responses)
and the filters its query used, plus the count it returned. The description travels as a ``row_sets`` ``CUSTOM`` event.
The model never sees it and cannot change it. The browser does not send it back either: it names a row set by id, and
the BE Lambda reads the description from the run's own event log, then runs the rows query under the caller's RLS
session. So the table lists the rows the answer counted, limited by RLS, and nobody can widen it from the client.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

RowKind = Literal["calls", "hcps", "responses"]

MAX_ROW_SETS = 14

KIND_UNITS = {"calls": "calls", "hcps": "HCPs", "responses": "responses"}


class RowSet(BaseModel):
    """What one rows query counted. Field names are the event's wire names."""

    row_set_id: str
    kind: RowKind
    label: str
    unit: str
    #: The count the tool returned, i.e. the number the table must add up to.
    count: int
    period_from: str
    period_to: str
    scope: str
    #: The fact or visual this set sits behind, so the interface can tie the table to the figure.
    source_id: str = ""
    territory_id: str | None = None
    product: str | None = None
    specialty: str | None = None
    topic: str | None = None
    question_id: str | None = None
    answer_type: str | None = None
    answer_label: str | None = None
    free_text: bool = False

    def event_value(self) -> dict[str, object]:
        return self.model_dump(exclude_none=True, exclude_defaults=False)

    def key(self) -> tuple[object, ...]:
        """Two sets with the same key list the same rows, so only one is kept."""
        return (
            self.kind, self.period_from, self.period_to, self.territory_id, self.product, self.specialty,
            self.topic, self.question_id, self.answer_type, self.answer_label, self.free_text,
        )
