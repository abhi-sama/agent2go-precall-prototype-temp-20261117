"""Intentional typed boundary for the future narrow FE DynamoDB write tool."""

from __future__ import annotations

from typing import Protocol


class ConversationWriteTool(Protocol):
    def save_turn(self, *, user_id: str, thread_id: str, assistant_text: str) -> None:
        """Persist an approved conversation turn to FE DynamoDB (not implemented in ticket #3)."""
        ...
