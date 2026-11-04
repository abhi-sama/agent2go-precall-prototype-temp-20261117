"""Caller identity: token verification and the claims-win rule.

AppSync forwards the request headers to this Lambda. The ``authorization`` header holds
the Cognito ID token, which is verified here independently of AppSync: RS256
signature against the user pool JWKS, issuer, audience (app client), expiry, and
``token_use``. The browser also sends the IdP-provided full name and email
(``x-user-full-name`` / ``x-user-email``); token claims always win over those request
fields.

Local floci stand-in (docs/adr/0002): floci's AppSync passes ``ctx.request.headers``
as an empty map, so the raw token never reaches this Lambda locally. When
``A2G_TRUST_APPSYNC_IDENTITY=1`` *and* ``A2G_ENV=local``, the Lambda instead accepts the
claims AppSync forwarded (AppSync itself verified the signature) and still checks
issuer, audience, expiry and token_use. That fallback refuses to run in any other
environment.

Persona comes from Cognito groups. Territory scope never comes from the token; it is
resolved in Postgres from effective-dated entitlements.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import jwt

from a2g_logging import get_logger

from .errors import Forbidden, Unauthorized
from .settings import Settings

log = get_logger(__name__)

#: Cognito group -> (persona key returned to the frontend, persona passed to the DB session).
PERSONA_GROUPS: dict[str, tuple[str, str]] = {
    "MSL": ("msl", "MSL"),
    "Director": ("director", "Director"),
    "Executive": ("executive", "Executive"),
    "Administrator": ("admin", "Administrator"),
}

FULL_NAME_HEADER = "x-user-full-name"
EMAIL_HEADER = "x-user-email"
CLOCK_SKEW_SECONDS = 30


@dataclass(frozen=True)
class Identity:
    subject: str
    """Issuer-qualified subject, the key of the approved login-to-user mapping."""
    persona: str
    """Frontend persona key: msl | director | executive | admin."""
    db_persona: str
    """Persona name bound to the Postgres session (the Cognito group)."""
    full_name: str
    email: str
    token_source: str
    """``header`` (verified here) or ``appsync-identity`` (local floci stand-in)."""


class JwksCache:
    """Fetches and caches the user pool's signing keys, refreshing on unknown kid."""

    def __init__(self, url: str, ttl_seconds: int = 3600, min_refetch_seconds: int = 30) -> None:
        self.url = url
        self.ttl = ttl_seconds
        # Tokens with made-up key ids must not turn into one JWKS fetch each.
        self.min_refetch = min_refetch_seconds
        self._keys: dict[str, Any] = {}
        self._fetched_at = 0.0
        self._lock = threading.Lock()

    def _fetch(self) -> None:
        with urllib.request.urlopen(self.url, timeout=5) as resp:  # noqa: S310 - fixed config URL
            data = json.load(resp)
        self._keys = {k["kid"]: jwt.PyJWK(k).key for k in data.get("keys", []) if "kid" in k}
        self._fetched_at = time.monotonic()

    def key(self, kid: str) -> Any:
        with self._lock:
            age = time.monotonic() - self._fetched_at
            if age > self.ttl or (kid not in self._keys and age > self.min_refetch):
                self._fetch()
            if kid not in self._keys:
                raise Unauthorized("unknown_kid")
            return self._keys[kid]


def _headers(event: Mapping[str, Any]) -> dict[str, str]:
    raw = ((event.get("request") or {}).get("headers")) or {}
    return {str(k).lower(): str(v) for k, v in raw.items() if v is not None}


def _verify_token(token: str, settings: Settings, jwks: JwksCache) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise Unauthorized("malformed_token") from exc
    if header.get("alg") != "RS256" or not header.get("kid"):
        raise Unauthorized("unsupported_alg")
    try:
        claims = jwt.decode(
            token,
            key=jwks.key(header["kid"]),
            algorithms=["RS256"],
            audience=list(settings.client_ids),
            issuer=settings.issuer,
            leeway=CLOCK_SKEW_SECONDS,
            options={"require": ["exp", "iat", "iss", "aud", "sub", "token_use"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise Unauthorized("token_expired") from exc
    except jwt.InvalidAudienceError as exc:
        raise Unauthorized("wrong_audience") from exc
    except jwt.InvalidIssuerError as exc:
        raise Unauthorized("wrong_issuer") from exc
    except jwt.PyJWTError as exc:
        raise Unauthorized("invalid_token") from exc
    return claims


def _check_forwarded_claims(claims: Mapping[str, Any], settings: Settings) -> None:
    """Checks for claims AppSync already signature-verified (local stand-in only)."""
    if claims.get("iss") != settings.issuer:
        raise Unauthorized("wrong_issuer")
    aud = claims.get("aud")
    auds = aud if isinstance(aud, list) else [aud]
    if not set(auds) & set(settings.client_ids):
        raise Unauthorized("wrong_audience")
    try:
        exp = int(claims.get("exp"))  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise Unauthorized("missing_exp") from exc
    if exp + CLOCK_SKEW_SECONDS < time.time():
        raise Unauthorized("token_expired")
    if not claims.get("sub"):
        raise Unauthorized("missing_sub")


def _persona(claims: Mapping[str, Any]) -> tuple[str, str]:
    groups = claims.get("cognito:groups") or []
    if isinstance(groups, str):
        groups = [groups]
    known = sorted({g for g in groups if g in PERSONA_GROUPS})
    if len(known) != 1:
        # No persona, or an ambiguous one: authorization is deterministic, never a guess.
        raise Forbidden("no_persona" if not known else "ambiguous_persona")
    return PERSONA_GROUPS[known[0]]


def _claim_wins(claim: Any, requested: str | None, field: str) -> str:
    value = claim if isinstance(claim, str) and claim else None
    if value is not None and requested and requested != value:
        log.warning("request identity field overridden by token claim", field_name=field)
    return value or requested or ""


def resolve_identity(event: Mapping[str, Any], settings: Settings, jwks: JwksCache) -> Identity:
    headers = _headers(event)
    auth = headers.get("authorization", "")
    if auth:
        token = auth[7:] if auth.lower().startswith("bearer ") else auth
        claims = _verify_token(token.strip(), settings, jwks)
        token_source = "header"
        forwarded = ((event.get("identity") or {}).get("claims")) or {}
        if forwarded.get("sub") and forwarded.get("sub") != claims.get("sub"):
            raise Unauthorized("identity_mismatch")
    elif settings.trust_appsync_identity:
        claims = ((event.get("identity") or {}).get("claims")) or {}
        _check_forwarded_claims(claims, settings)
        token_source = "appsync-identity"
    else:
        raise Unauthorized("missing_token")

    if claims.get("token_use") != "id":
        # The ID token carries the IdP name and email the claims-win rule needs.
        raise Unauthorized("not_an_id_token")

    persona, db_persona = _persona(claims)
    return Identity(
        subject=f"cognito|{claims['sub']}",
        persona=persona,
        db_persona=db_persona,
        full_name=_claim_wins(claims.get("name"), headers.get(FULL_NAME_HEADER), "full_name"),
        email=_claim_wins(claims.get("email"), headers.get(EMAIL_HEADER), "email"),
        token_source=token_source,
    )
