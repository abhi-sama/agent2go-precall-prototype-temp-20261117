"""Page-change proposals: the agent suggests new filters for the page, the person decides (docs/adr/0019).

The detector is deterministic and runs before any model or tool, so a model (or text inside a tool result) can never
change what the page shows. It only reads the question's own words; nothing here reads data. The territory it names is
checked against the caller's scope by ``MslAgent.run`` before a proposal is made, and the page re-checks every value
when the person chooses Apply.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

MAX_SPAN_DAYS = 1830

_VERBS = r"(?:filter|switch|set|change|narrow|limit|focus|apply|update|move|reset|clear)"
_PAGE = r"(?:page|screen|dashboard|view|filters?)"
#: The change verb must open the request, after optional politeness. "show" is not one: "show me the calls ..." is a
#: data question, and so is anything that merely mentions a verb later in the sentence.
_POLITE = r"^\s*(?:(?:please|can you|could you|would you|i want to|let'?s)[,\s]+)*"
_OPENING = rf"{_POLITE}{_VERBS}\b"
#: "filter the page", "reset the filters", "switch the dashboard", "update my view".
_VERB_THEN_PAGE = re.compile(rf"{_OPENING}\s+(?:the\s+|this\s+|my\s+|all\s+|these\s+)?{_PAGE}\b", re.I)
#: "switch to T01-02 on the dashboard", "set the last 90 days on this page".
_VERB_THEN_ON_PAGE = re.compile(rf"{_OPENING}\b[^.?!]*\b(?:on|in|for|to)\s+(?:the\s+|this\s+|my\s+)?(?:page|screen|dashboard|view)\b", re.I)
_RESET = re.compile(rf"{_POLITE}(?:reset|clear)\s+(?:the\s+|this\s+|my\s+|all\s+)?{_PAGE}\b", re.I)

_TERRITORY = re.compile(r"\b(T\d{2}-\d{2})\b", re.I)
_QUESTION_ID = re.compile(r"\b(Q-[A-Za-z0-9_.:-]+)", re.I)
_ISO_DATE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
_PRESETS = (
    (re.compile(r"\blast\s+7\s+days\b", re.I), "7d"),
    (re.compile(r"\blast\s+30\s+days\b", re.I), "30d"),
    (re.compile(r"\blast\s+90\s+days\b", re.I), "90d"),
    (re.compile(r"\b(?:quarter[- ]to[- ]date|this\s+quarter)\b", re.I), "qtd"),
    (re.compile(r"\b(?:year[- ]to[- ]date|this\s+year)\b", re.I), "ytd"),
)
PRESET_WORDS = {
    "7d": "the last 7 days",
    "30d": "the last 30 days",
    "90d": "the last 90 days",
    "qtd": "quarter to date",
    "ytd": "year to date",
}


@dataclass(frozen=True)
class PageProposal:
    """New filters for the page. ``filters`` uses the page's own names; a preset or a window, never both."""

    filters: dict[str, str] = field(default_factory=dict)
    reset: bool = False

    @property
    def territory_id(self) -> str | None:
        return self.filters.get("territoryId")

    @property
    def needs_record_scope(self) -> bool:
        """A territory or question filter narrows to record-level scope, which an aggregate-only role does not have."""
        return "territoryId" in self.filters or "questionId" in self.filters

    def summary(self) -> str:
        parts: list[str] = []
        if "territoryId" in self.filters:
            parts.append(f"territory {self.filters['territoryId']}")
        if "questionId" in self.filters:
            parts.append(f"question {self.filters['questionId']}")
        if "preset" in self.filters:
            parts.append(PRESET_WORDS[self.filters["preset"]])
        elif "from" in self.filters:
            parts.append(f"{self.filters['from']} to {self.filters['to']}")
        if self.reset and not parts:
            return "its default filters"
        return ", ".join(parts)

    def reason(self) -> str:
        return "Reset the page filters to their defaults." if self.reset and not self.filters else f"Set the page to {self.summary()}."

    def answer(self) -> str:
        what = self.summary()
        return (
            f"I can set the page to {what}. Choose Apply on the card below to change the page filters; "
            "nothing changes until you do."
        )

    def state(self, run_id: str) -> dict[str, object]:
        out: dict[str, object] = {
            "id": f"{run_id}-proposal",
            "status": "proposed",
            "reason": self.reason(),
            "filters": dict(self.filters),
        }
        if self.reset:
            out["reset"] = True
        return out


def _window(question: str) -> tuple[str, str] | None:
    dates = _ISO_DATE.findall(question)
    if len(dates) < 2:
        return None
    try:
        start, end = dt.date.fromisoformat(dates[0]), dt.date.fromisoformat(dates[1])
    except ValueError:
        return None
    if start > end or (end - start).days > MAX_SPAN_DAYS:
        return None
    return start.isoformat(), end.isoformat()


def infer_page_proposal(question: str) -> PageProposal | None:
    """The filters a question asks the page to take, or None when it is not such a request."""
    if not (_VERB_THEN_PAGE.search(question) or _VERB_THEN_ON_PAGE.search(question)):
        return None
    filters: dict[str, str] = {}
    if territory := _TERRITORY.search(question):
        filters["territoryId"] = territory.group(1).upper()
    if qid := _QUESTION_ID.search(question):
        value = qid.group(1).rstrip(".:-_")
        if len(value) <= 64 and len(value) > 2:
            filters["questionId"] = "Q-" + value[2:]
    if window := _window(question):
        filters["from"], filters["to"] = window
    else:
        for pattern, preset in _PRESETS:
            if pattern.search(question):
                filters["preset"] = preset
                break
    reset = bool(_RESET.search(question))
    if not filters and not reset:
        return None
    return PageProposal(filters=filters, reset=reset)
