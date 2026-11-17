"""Preferences the agent may suggest remembering, noticed from how a person asks (docs/adr/0023).

Option B of "Ask the agent remembers": after an answer, the agent may offer one preference it noticed in this
conversation ("You asked for the last 90 days 3 times. Remember that?"). It is code, not the model: a small closed set
of detectors counts the person's own messages and fills a fixed template, so a suggestion is always a way of working
(a date range, tables or charts, a length, a therapeutic area from a closed list), never a name, record id or figure
from the data. Every suggestion still passes the guard of docs/adr/0022 and is saved only when the person clicks
Remember; Dismiss records its key so it is not offered again.

The BE chooses nothing here: it supplies what is already remembered, which suggestions were dismissed (as keys, never
text) and whether this conversation already had one. The same detectors are mirrored for the mock adapter
(``frontend/src/lib/data/memory-suggest.ts``); both run ``backend/agent_memory_suggestion_cases.json``.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from .memory import check_preference

#: How many of a person's messages must show the same preference before it is worth offering.
MIN_COUNT = 3
#: Most suggestions shown when the person asks "what have you noticed?". An automatic offer is always one.
MAX_ASKED = 3
MAX_DISMISSED = 50

_DATE = re.compile(r"\b(?:last|past|previous)\s+(\d{1,3})\s*[- ]?\s*(day|week|month|quarter)s?\b|\b(\d{1,3})[- ](day|week|month|quarter)s?\b", re.I)
_DATE_MAX = {"day": 366, "week": 52, "month": 24, "quarter": 8}
_TABLE = re.compile(r"\b(?:tables?|tabular)\b", re.I)
_CHART = re.compile(r"\b(?:charts?|graphs?|plots?)\b", re.I)
_BULLETS = re.compile(r"\b(\d{1,2})\s+bullet(?:s|\s+points?)?\b", re.I)
_SHORT = re.compile(
    r"\b(?:keep (?:it|this|that|answers?|replies|them) (?:short|brief|concise)|be (?:brief|concise)|tl;?dr"
    r"|(?:shorter|more concise|concise|short) (?:answers?|repl(?:y|ies)|summar(?:y|ies)|responses?))\b",
    re.I,
)
#: A closed list: a therapeutic area is a way of working; a free-text "focus on ..." could be a person or a record.
_AREAS = (
    "oncology", "cardiology", "neurology", "immunology", "dermatology", "hematology", "respiratory", "diabetes",
    "endocrinology", "rheumatology", "gastroenterology",
)
_AREA = re.compile(r"\b(" + "|".join(_AREAS) + r")\b", re.I)

#: A message that already asks the agent to remember something, or to suggest, is not evidence of a habit.
_COMMAND = re.compile(r"^\s*(?:please\s+)?remember\b", re.I)
_ASK = re.compile(
    r"^(?:please\s+)?(?:suggest\s+(?:some\s+|any\s+)?(?:preferences?|things? to remember)"
    r"|what (?:have you noticed|did you notice) about how i (?:like to )?(?:work|ask)"
    r"|what should you remember(?: about me| about how i work)?"
    r"|(?:any )?preferences? (?:you(?:'ve| have) )?noticed)\s*[?.!]*$",
    re.I,
)

ASK_REPLY = "Here is what I noticed in this conversation. Nothing is saved unless you choose Remember."
ASK_NONE = "I have not noticed a preference worth remembering yet. You can always say: remember I prefer tables."


@dataclass(frozen=True)
class Suggestion:
    text: str
    category: str
    reason: str

    def event(self) -> dict[str, str]:
        return {"text": self.text, "category": self.category, "reason": self.reason}


def suggestion_key(text: str) -> str:
    """The key a dismissal is stored under: a hash of the text, so the store holds no preference words (docs/adr/0023)."""
    return hashlib.sha256(" ".join(text.split()).casefold().encode()).hexdigest()[:16]


def is_suggestion_request(question: str) -> bool:
    """The person asks what the agent has noticed: the one case where more than one suggestion per conversation is fine."""
    return _ASK.match(question.strip()) is not None


def _habit(messages: Sequence[str], extract: Any) -> tuple[Any, int] | None:
    """The value that appears in the most messages (at least ``MIN_COUNT``; ties go to the one seen first)."""
    counts: dict[Any, int] = {}
    for message in messages:
        for value in dict.fromkeys(extract(message)):
            counts[value] = counts.get(value, 0) + 1
    best = max(counts.items(), key=lambda item: item[1], default=None)
    return best if best is not None and best[1] >= MIN_COUNT else None


def _ranges(message: str) -> list[tuple[int, str]]:
    out = []
    for match in _DATE.finditer(message):
        number, unit = (match.group(1), match.group(2)) if match.group(1) else (match.group(3), match.group(4))
        n = int(number)
        if 2 <= n <= _DATE_MAX[unit.lower()]:
            out.append((n, unit.lower()))
    return out


def _bullets(message: str) -> list[int]:
    return [int(m.group(1)) for m in _BULLETS.finditer(message) if 2 <= int(m.group(1)) <= 10]


def _areas(message: str) -> list[str]:
    return [m.group(1).lower() for m in _AREA.finditer(message)]


def noticed(user_messages: Iterable[str]) -> list[Suggestion]:
    """Every preference the person's own messages show, most useful first, before anything is filtered out."""
    messages = [m for m in user_messages if isinstance(m, str) and not _COMMAND.match(m) and not is_suggestion_request(m)]
    found: list[Suggestion] = []
    if (date := _habit(messages, _ranges)) is not None:
        (n, unit), count = date
        found.append(Suggestion(f"Default to the last {n} {unit}s", "DATE_RANGE", f"You asked for the last {n} {unit}s {count} times."))
    tables = sum(1 for m in messages if _TABLE.search(m))
    charts = sum(1 for m in messages if _CHART.search(m))
    if tables >= MIN_COUNT and tables > charts:
        found.append(Suggestion("I prefer tables over charts", "FORMAT", f"You asked for a table {tables} times."))
    elif charts >= MIN_COUNT and charts > tables:
        found.append(Suggestion("I prefer charts over tables", "FORMAT", f"You asked for a chart {charts} times."))
    if (bullets := _habit(messages, _bullets)) is not None:
        found.append(Suggestion(f"Keep answers to {bullets[0]} bullets", "LENGTH", f"You asked for {bullets[0]} bullets {bullets[1]} times."))
    short = sum(1 for m in messages if _SHORT.search(m))
    if short >= MIN_COUNT:
        found.append(Suggestion("Keep answers short", "LENGTH", f"You asked for shorter answers {short} times."))
    if (area := _habit(messages, _areas)) is not None:
        found.append(Suggestion(f"Focus on {area[0]}", "FOCUS", f"You asked about {area[0]} {area[1]} times."))
    # Belt and braces: the templates cannot hold a record fact, but the same guard that protects the store checks them.
    return [s for s in found if check_preference(s.text) is None]


def suggest_preferences(
    user_messages: Iterable[str], remembered: Iterable[Any], dismissed: Iterable[Any]
) -> list[Suggestion]:
    """What to offer: what was noticed, minus what is already remembered (same text, any case) or was dismissed."""
    saved = {" ".join(str(item.get("text", "")).split()).casefold() for item in remembered if isinstance(item, dict)}
    gone = {key for key in dismissed if isinstance(key, str)}
    return [s for s in noticed(user_messages) if s.text.casefold() not in saved and suggestion_key(s.text) not in gone]
