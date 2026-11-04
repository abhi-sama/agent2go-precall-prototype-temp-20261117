"""Guard for the rule that numbers in an answer come from deterministic queries, not the model.

The facts shown to the user are built from SQL results (``Fact``). The model's prose may only
repeat figures that appeared in a tool result or in the user's own question. Anything else is
reported as unverified so the UI can warn instead of presenting a model-made number as data.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

_ISO_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
# Identifiers such as T01-01, CALL-00001, HCP-0001, RESP-000001, DESTINY-Breast06.
_IDENTIFIER = re.compile(r"\b[A-Za-z][A-Za-z]*[-_]?\d[\w-]*")
_LIST_MARKER = re.compile(r"(?m)^\s*\d+[.)]\s")
_NUMBER = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?")


def _normalise(token: str) -> str:
    cleaned = token.replace(",", "")
    if "." in cleaned:
        whole, _, frac = cleaned.partition(".")
        frac = frac.rstrip("0")
        return f"{int(whole)}.{frac}" if frac else str(int(whole))
    return str(int(cleaned))


def numbers_in(text: str) -> list[str]:
    """Figures a reader would take as claims; dates, identifiers and list markers are not claims."""
    stripped = _ISO_DATE.sub(" ", text)
    stripped = _IDENTIFIER.sub(" ", stripped)
    stripped = _LIST_MARKER.sub(" ", stripped)
    return [_normalise(m.group(0)) for m in _NUMBER.finditer(stripped)]


def allowed_numbers(sources: Iterable[str]) -> set[str]:
    """Every figure present in tool results or the user's question, dates included (so "2026" passes)."""
    allowed: set[str] = set()
    for source in sources:
        for m in re.finditer(r"\d[\d,]*(?:\.\d+)?", source):
            allowed.add(_normalise(m.group(0)))
    return allowed


def unverified_numbers(answer: str, allowed: set[str]) -> list[str]:
    seen: list[str] = []
    for number in numbers_in(answer):
        if number not in allowed and number not in seen:
            seen.append(number)
    return seen
