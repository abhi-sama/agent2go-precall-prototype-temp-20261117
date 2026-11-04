"""Embedding providers used by insight search.

The resolver depends on this small interface, not on a particular model.  Local
development uses the dependency-free provider below; AWS configuration selects
Titan without changing search or authorization code.  The local provider is a
deterministic, privacy-preserving stand-in for the configured open-source
sentence model, which lets floci tests run without downloading model weights.
"""
from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from typing import Protocol

import boto3

DIMENSIONS = 1536  # Matches Titan Text Embeddings v1 and the pgvector column.


class EmbeddingProvider(Protocol):
    def embed(self, text: str) -> list[float]: ...


def _hashed_embedding(text: str) -> list[float]:
    """Stable local embedding for fixtures; text never leaves the process."""
    values = [0.0] * DIMENSIONS
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    for token in tokens:
        digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "big") % DIMENSIONS
        values[index] += 1.0 if digest[4] & 1 else -1.0
    length = math.sqrt(sum(value * value for value in values))
    return [value / length for value in values] if length else values


@dataclass(frozen=True)
class LocalOpenSourceEmbeddingProvider:
    """Local-only compatible provider (replaceable by an on-device OSS model)."""
    model: str = "local-open-source"

    def embed(self, text: str) -> list[float]:
        return _hashed_embedding(text)


@dataclass(frozen=True)
class BedrockTitanEmbeddingProvider:
    model_id: str = "amazon.titan-embed-text-v1"
    endpoint_url: str | None = None
    region_name: str = "us-east-1"

    def embed(self, text: str) -> list[float]:
        client = boto3.client("bedrock-runtime", endpoint_url=self.endpoint_url, region_name=self.region_name)
        response = client.invoke_model(modelId=self.model_id, body=("{\"inputText\": " + __import__("json").dumps(text) + "}"))
        return list(__import__("json").loads(response["body"].read())["embedding"])


def provider_from_config(kind: str, *, endpoint_url: str | None = None, region_name: str = "us-east-1") -> EmbeddingProvider:
    if kind == "local":
        return LocalOpenSourceEmbeddingProvider()
    if kind == "titan":
        return BedrockTitanEmbeddingProvider(endpoint_url=endpoint_url, region_name=region_name)
    raise ValueError("invalid_embedding_provider")


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8g}" for value in values) + "]"
