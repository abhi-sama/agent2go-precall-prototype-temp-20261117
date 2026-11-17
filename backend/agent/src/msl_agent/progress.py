"""The agent's progress as AG-UI shared state (docs/adr/0019).

A run reports what it is doing as ``STATE_SNAPSHOT`` events whose value is ``{"progress": {...}}``. Every label comes
from the closed catalog below, so no row value, name or figure can ride along in a step. The chat shows the steps while
the answer is written; they are never evidence and are not stored.
"""

from __future__ import annotations

from typing import Any

from . import ag_ui

MAX_STEPS = 12

SCOPE = "scope"
WRITE = "write"
CHECK = "check"

LABELS = {
    SCOPE: "Checking what you can see",
    WRITE: "Writing the answer",
    CHECK: "Checking every number against your data",
}

#: Plain words for each tool call. Anything not listed (the Executive tools included) is "Looking something up".
TOOL_LABELS = {
    "get_activity_summary": "Counting your activity",
    "search_recorded_responses": "Reading recorded responses",
    "get_topic_trends": "Finding topic trends",
    "get_question_breakdown": "Breaking down a question",
    "show_chart": "Drawing a chart",
    "show_answer_distribution": "Drawing a chart",
    "get_my_scope": "Checking your scope",
    "suggest_follow_ups": "Preparing follow-up questions",
}
OTHER_TOOL = "Looking something up"


def tool_label(name: str) -> str:
    return TOOL_LABELS.get(name, OTHER_TOOL)


class Progress:
    """The steps of one run, in the order they began. Capped, so a chatty run cannot grow the state."""

    def __init__(self) -> None:
        self._steps: dict[str, str] = {}
        self._labels: dict[str, str] = {}
        self.proposal: dict[str, Any] | None = None

    def begin(self, step_id: str, label: str | None = None) -> None:
        """Start a step (a no-op if it exists or the cap is reached)."""
        if step_id in self._steps or len(self._steps) >= MAX_STEPS:
            return
        self._steps[step_id] = "running"
        self._labels[step_id] = label or LABELS[step_id]

    def end(self, step_id: str, status: str = "done") -> None:
        if step_id in self._steps and self._steps[step_id] == "running":
            self._steps[step_id] = status

    def close(self, status: str) -> None:
        """Finish every step still running: ``done`` for a finished run, ``error`` for one that failed."""
        for step_id, current in self._steps.items():
            if current == "running":
                self._steps[step_id] = status

    def snapshot(self, status: str = "running") -> ag_ui.Event:
        value: dict[str, Any] = {
            "progress": {
                "status": status,
                "steps": [{"id": sid, "label": self._labels[sid], "status": st} for sid, st in self._steps.items()],
            }
        }
        if self.proposal is not None:
            value["proposal"] = self.proposal
        return ag_ui.state_snapshot(value)

    def final(self, status: str = "done") -> ag_ui.Event:
        """Close every step and return the last snapshot of the run."""
        self.close("error" if status == "error" else "done")
        return self.snapshot(status)
