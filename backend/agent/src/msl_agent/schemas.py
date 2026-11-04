from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Identity(BaseModel):
    user_id: str = Field(min_length=1)
    persona: str = Field(min_length=1)
    full_name: str = Field(min_length=1)
    email: str = Field(min_length=1)
    correlation_id: str = Field(min_length=1)


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class Invocation(BaseModel):
    identity: Identity
    thread_id: str = Field(min_length=1)
    messages: list[Message] = Field(min_length=1, max_length=100)


class Citation(BaseModel):
    record_id: str
    dataset: str
    label: str
