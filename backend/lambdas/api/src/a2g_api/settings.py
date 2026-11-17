"""Configuration from the Lambda environment. Read once per cold start."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    env: str
    issuer: str
    jwks_url: str
    client_ids: tuple[str, ...]
    trust_appsync_identity: bool
    db_dsn: str
    default_range_days: int
    flags_table: str | None = None
    flags_role_arn: str | None = None
    briefs_table: str | None = None
    briefs_role_arn: str | None = None
    chat_history_table: str | None = None
    chat_history_role_arn: str | None = None
    chat_worker_function: str | None = None
    eval_table: str | None = None
    eval_role_arn: str | None = None
    eval_worker_function: str | None = None
    agent_url: str | None = None
    agent_runtime_arn: str | None = None
    saved_views_table: str | None = None
    saved_views_endpoint: str | None = None
    saved_views_access_key: str | None = None
    saved_views_region: str = "us-east-1"
    fe_appsync_url: str | None = None
    embedding_provider: str = "local"
    embedding_endpoint: str | None = None
    llm_backend: str = ""
    cli_eval_workers: int | None = None

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> Settings:
        e = os.environ if environ is None else environ
        env = e.get("A2G_ENV", "aws")
        issuer = e["A2G_COGNITO_ISSUER"].rstrip("/")
        trust = e.get("A2G_TRUST_APPSYNC_IDENTITY", "0") == "1"
        if trust and env != "local":
            # The floci stand-in must never be switched on in a deployed account.
            raise RuntimeError("A2G_TRUST_APPSYNC_IDENTITY is only allowed when A2G_ENV=local")
        local_access_key = e.get("A2G_SAVED_VIEWS_ACCESS_KEY")
        if local_access_key and env != "local":
            raise RuntimeError("A2G_SAVED_VIEWS_ACCESS_KEY is only allowed when A2G_ENV=local")
        return cls(
            env=env,
            issuer=issuer,
            jwks_url=e.get("A2G_COGNITO_JWKS_URL") or f"{issuer}/.well-known/jwks.json",
            client_ids=tuple(c.strip() for c in e["A2G_COGNITO_CLIENT_IDS"].split(",") if c.strip()),
            trust_appsync_identity=trust,
            db_dsn=e["A2G_DB_DSN"],
            default_range_days=int(e.get("A2G_DEFAULT_RANGE_DAYS", "90")),
            flags_table=e.get("A2G_FLAGS_TABLE") or None,
            flags_role_arn=e.get("A2G_FLAGS_ROLE_ARN") or None,
            briefs_table=e.get("A2G_BRIEFS_TABLE") or None,
            briefs_role_arn=e.get("A2G_BRIEFS_ROLE_ARN") or None,
            chat_history_table=e.get("A2G_CHAT_HISTORY_TABLE") or None,
            chat_history_role_arn=e.get("A2G_CHAT_HISTORY_ROLE_ARN") or None,
            chat_worker_function=e.get("A2G_CHAT_WORKER_FUNCTION") or None,
            eval_table=e.get("A2G_EVAL_TABLE") or None,
            eval_role_arn=e.get("A2G_EVAL_ROLE_ARN") or None,
            eval_worker_function=e.get("A2G_EVAL_WORKER_FUNCTION") or None,
            # Local: the agent container's HTTP address. AWS: the AgentCore Runtime ARN (ticket #24).
            agent_url=(e.get("A2G_AGENT_URL") or "").rstrip("/") or None,
            agent_runtime_arn=e.get("A2G_AGENT_RUNTIME_ARN") or None,
            saved_views_table=e.get("A2G_SAVED_VIEWS_TABLE"),
            saved_views_endpoint=e.get("A2G_SAVED_VIEWS_ENDPOINT"),
            saved_views_access_key=local_access_key,
            saved_views_region=e.get("AWS_REGION", "us-east-1"),
            # AWS only: the worker's IAM role is restricted to publishChatEvent on this API.
            fe_appsync_url=(e.get("A2G_FE_APPSYNC_URL") or "").rstrip("/") or None,
            embedding_provider=e.get("A2G_EMBEDDING_PROVIDER", "local"),
            embedding_endpoint=e.get("A2G_BEDROCK_ENDPOINT") or e.get("AWS_ENDPOINT_URL") or None,
            llm_backend=e.get("A2G_LLM_BACKEND", "").lower(),
            # A local CLI can opt into additional suite workers when its bridge has matching slots.
            # Absent or invalid input retains the sustainable two-worker default.
            cli_eval_workers=_local_cli_workers(e, env),
        )


def _local_cli_workers(environ: dict[str, str], env: str) -> int | None:
    """Return an explicit local-only CLI suite fan-out, if it is usable."""
    if env != "local":
        return None
    try:
        workers = int(environ.get("A2G_CLI_EVAL_WORKERS", ""))
    except ValueError:
        return None
    return workers if 1 <= workers <= 8 else None
