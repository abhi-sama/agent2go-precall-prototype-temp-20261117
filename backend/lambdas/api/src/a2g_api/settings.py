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

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> Settings:
        e = os.environ if environ is None else environ
        env = e.get("A2G_ENV", "aws")
        issuer = e["A2G_COGNITO_ISSUER"].rstrip("/")
        trust = e.get("A2G_TRUST_APPSYNC_IDENTITY", "0") == "1"
        if trust and env != "local":
            # The floci stand-in must never be switched on in a deployed account.
            raise RuntimeError("A2G_TRUST_APPSYNC_IDENTITY is only allowed when A2G_ENV=local")
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
        )
