"""Runtime-only configuration. No credentials are persisted by this package."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_KEY_PATH = Path.home() / ".config" / "agent2go" / "keys.env"


def read_anthropic_api_key(path: Path = DEFAULT_KEY_PATH) -> str | None:
    """Read the key on demand without exporting, logging, or storing it in the repo.

    Only the host-side live tests and run-local.sh use this; the containerised runtime never sees
    the key: LiteLLM does, and the agent reaches Claude only through floci's Bedrock proxy.
    """
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
    bedrock_endpoint: str | None
    bedrock_model_id: str
    aws_region: str
    database_url: str | None
    #: "proxy" (floci -> LiteLLM -> Claude) or "stub" (floci's canned Bedrock answer, no key).
    floci_backend: str
    fe_write_role_arn: str | None = None
    fe_chat_table: str | None = None
    fe_brief_write_role_arn: str | None = None
    fe_brief_table: str | None = None
    max_output_tokens: int = 700
    #: Local subscription CLIs are materially slower than a hosted model API.
    llm_backend: str = ""

    @property
    def cli_backend(self) -> bool:
        return self.llm_backend in {"claude-cli", "codex-cli"}

    @classmethod
    def from_environment(cls) -> Settings:
        backend = os.getenv("A2G_BEDROCK_BACKEND", "stub").lower()
        return cls(
            # BedrockModel talks to floci. Unset means the SDK default (real Bedrock) in AWS.
            bedrock_endpoint=os.getenv("BEDROCK_ENDPOINT_URL") or None,
            bedrock_model_id=os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-5-5-v1:0"),
            aws_region=os.getenv("AWS_REGION", "us-east-1"),
            database_url=os.getenv("DATABASE_URL") or None,
            floci_backend="proxy" if backend == "proxy" else "stub",
            fe_write_role_arn=os.getenv("A2G_FE_WRITE_ROLE_ARN") or None,
            fe_chat_table=os.getenv("A2G_FE_CHAT_TABLE") or None,
            fe_brief_write_role_arn=os.getenv("A2G_FE_BRIEF_WRITE_ROLE_ARN") or None,
            fe_brief_table=os.getenv("A2G_FE_BRIEF_TABLE") or None,
            llm_backend=os.getenv("A2G_LLM_BACKEND", "").lower(),
        )
