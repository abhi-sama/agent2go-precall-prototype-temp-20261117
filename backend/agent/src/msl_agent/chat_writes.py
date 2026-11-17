"""The four explicit writes Ask the agent may propose.

The parser is intentionally small and deterministic.  A free-form chat request never becomes a
mutation until it has been represented by one of these closed action shapes and the user has
approved (or edited) it in the interrupt UI.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .memory import CATEGORIES, categorize, check_preference


@dataclass(frozen=True)
class PendingWrite:
    kind: str
    title: str
    description: str
    values: dict[str, Any]

    def interrupt(self, run_id: str) -> dict[str, Any]:
        return {
            "id": f"write-{run_id}",
            "reason": "approval",
            "message": self.description,
            "metadata": {"kind": self.kind, "title": self.title, "values": self.values},
        }


_BRIEF = re.compile(r"(?:save|create|generate)\s+(?:a\s+)?pre-?call brief\s+for\s+(HCP-[A-Za-z0-9_-]+)\s*[:|-]?\s*(.+)", re.I | re.S)
_POST_CALL = re.compile(r"(?:save|create)\s+(?:a\s+)?post-?call(?:\s+workflow)?(?:\s+output)?\s*[:|-]\s*(.+)", re.I | re.S)
_FLAG = re.compile(r"(?:set|create|save)\s+(?:a\s+)?feedback flag\s+(SUMMARY|IDENTIFIER|TERRITORY_ASSIGNMENT)\s+(SUMMARY|CALL|HCP|TERRITORY)\s+([A-Za-z0-9:_.-]+)\s*[:|-]?\s*(.*)", re.I | re.S)


# "Remember I prefer tables", "remember that I want 90 days", "remember this: keep briefs short". Only an imperative at the
# start of the message: a question such as "do you remember..." is ordinary chat.
_REMEMBER = re.compile(r"(?:please\s+)?remember\b(?:\s+(?:that|this)\b)?\s*[:,-]?\s*(.*)", re.I | re.S)

MEMORY_REFUSAL = (
    "I remember how you like to work, such as tables over charts or a default 90-day range. I do not save names, record IDs, "
    "calls or figures: those are always read fresh from your data. Rephrase it as a preference to try again."
)
MEMORY_EMPTY = "Tell me what to remember, for example: remember I prefer tables."


def _memory_write(text: object, category: object) -> PendingWrite | None:
    """A preference to save, or None when it is not one: the same rules the BE applies before storing it (docs/adr/0022)."""
    if not isinstance(text, str) or category not in CATEGORIES:
        return None
    cleaned = " ".join(text.split()).rstrip(" .!")
    if check_preference(cleaned) is not None:
        return None
    return PendingWrite(
        "save_preference",
        "Remember this preference",
        f"Remember this about how you like to work: \u201c{cleaned}\u201d?",
        {"text": cleaned, "category": category},
    )


def memory_refusal(question: str) -> str | None:
    """The fixed reply to a remember request that is not a preference (a record fact, a figure, a name); else None."""
    match = _REMEMBER.fullmatch(question.strip())
    if match is None:
        return None
    text = " ".join(match.group(1).split()).rstrip(" .!")
    if not text:
        return MEMORY_EMPTY
    return MEMORY_REFUSAL if check_preference(text) is not None else None


def parse_pending_write(question: str) -> PendingWrite | None:
    """Recognise only an explicit, complete write request; ordinary chat stays read-only."""
    text = question.strip()
    if match := _REMEMBER.fullmatch(text):
        item = " ".join(match.group(1).split()).rstrip(" .!")
        return _memory_write(item, categorize(item)) if item else None
    if match := _BRIEF.fullmatch(text):
        hcp_id, objective = match.groups()
        objective = objective.strip()
        if objective and len(objective) <= 600:
            return PendingWrite("pre_call_brief", "Save pre-call brief", f"Save a generated brief for {hcp_id}?", {"hcpId": hcp_id, "objective": objective})
    if match := _POST_CALL.fullmatch(text):
        notes = match.group(1).strip()
        if notes and len(notes) <= 8_000:
            return PendingWrite("post_call_output", "Save post-call workflow output", "Save this post-call workflow output as a draft?", {"notes": notes})
    if match := _FLAG.fullmatch(text):
        kind, target_type, target_id, note = match.groups()
        kind, target_type = kind.upper(), target_type.upper()
        if (kind, target_type) in {("SUMMARY", "SUMMARY"), ("IDENTIFIER", "HCP"), ("IDENTIFIER", "CALL"), ("TERRITORY_ASSIGNMENT", "HCP"), ("TERRITORY_ASSIGNMENT", "CALL"), ("TERRITORY_ASSIGNMENT", "TERRITORY")}:
            return PendingWrite("feedback_flag", "Set feedback flag", f"Set a {kind.lower().replace('_', ' ')} feedback flag?", {"kind": kind, "targetType": target_type, "targetId": target_id, "note": note.strip()[:500]})
    return None


def approved_write(metadata: object, response: object) -> PendingWrite | None:
    """Rebuild an approved action from the event-log metadata and bounded user edits."""
    if not isinstance(metadata, dict) or not isinstance(response, dict) or response.get("approved") is not True:
        return None
    kind, title, values = metadata.get("kind"), metadata.get("title"), metadata.get("values")
    if not isinstance(kind, str) or not isinstance(title, str) or not isinstance(values, dict):
        return None
    edited = response.get("values")
    if isinstance(edited, dict):
        values = {**values, **{key: value for key, value in edited.items() if key in values and isinstance(value, str)}}
    # Re-parse the canonical request so edited values keep every size and shape bound above.
    if kind == "pre_call_brief":
        return parse_pending_write(f"save pre-call brief for {values.get('hcpId', '')}: {values.get('objective', '')}")
    if kind == "post_call_output":
        return parse_pending_write(f"save post-call output: {values.get('notes', '')}")
    if kind == "save_preference":
        return _memory_write(values.get("text"), values.get("category"))
    if kind == "feedback_flag":
        return parse_pending_write(f"set feedback flag {values.get('kind', '')} {values.get('targetType', '')} {values.get('targetId', '')}: {values.get('note', '')}")
    return None
