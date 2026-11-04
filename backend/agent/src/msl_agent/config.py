"""Runtime-only configuration. No credentials are persisted by this package."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_KEY_PATH = Path.home() / ".config" / "agent2go" / "keys.env"


def read_anthropic_api_key(path: Path = DEFAULT_KEY_PATH) -> str | None:
    """Read the key on demand without exporting, logging, or storing it in the repo."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return None

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line.removeprefix("export ").strip()
        key, separator, value = line.partition("=")
        if separator and key.strip() == "ANTHROPIC_API_KEY":
            return value.strip().strip('"').strip("'") or None
    return None


@dataclass(frozen=True)
class Settings:
    bedrock_endpoint: str
    bedrock_model_id: str
    aws_region: str
    database_url: str | None
    floci_backend: str
    use_stub_model: bool

    @classmethod
    def from_environment(cls, *, key_path: Path = DEFAULT_KEY_PATH) -> Settings:
        # The key is deliberately read only to select proxy versus floci's stub backend.
        # LiteLLM receives it at process start from scripts/run-local.sh; this process never
        # logs it or puts it in a request. The internal stub is only for deterministic tests;
        # actual no-key runtime calls floci's Bedrock stub through ConverseStream.
        api_key_present = bool(read_anthropic_api_key(key_path))
        return cls(
            bedrock_endpoint=os.getenv("BEDROCK_ENDPOINT_URL", "http://localhost:4568"),
            bedrock_model_id=os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-5-5-v1:0"),
            aws_region=os.getenv("AWS_REGION", "us-east-1"),
            database_url=os.getenv("DATABASE_URL") or None,
            floci_backend="proxy" if api_key_present else "stub",
            use_stub_model=os.getenv("MSL_AGENT_TEST_STUB", "").lower() in {"1", "true"},
        )
