"""Token verification and the claims-win rule, against locally minted RS256 tokens."""

from __future__ import annotations

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from a2g_api.errors import Forbidden, Unauthorized
from a2g_api.identity import JwksCache, resolve_identity
from a2g_api.settings import Settings

ISSUER = "http://floci:4566/us-east-1_test"
CLIENT = "client-123"
KID = "kid-1"

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class StaticJwks(JwksCache):
    def __init__(self) -> None:
        super().__init__("unused")

    def _fetch(self) -> None:
        self._keys = {KID: KEY.public_key()}
        self._fetched_at = time.monotonic()


def settings(**overrides) -> Settings:
    env = {
        "A2G_ENV": "aws",
        "A2G_COGNITO_ISSUER": ISSUER,
        "A2G_COGNITO_CLIENT_IDS": CLIENT,
        "A2G_DB_DSN": "postgresql://unused",
    }
    env.update(overrides)
    return Settings.from_env(env)


def claims(**overrides) -> dict:
    now = int(time.time())
    base = {
        "sub": "sub-1",
        "iss": ISSUER,
        "aud": CLIENT,
        "iat": now,
        "exp": now + 3600,
        "token_use": "id",
        "cognito:groups": ["MSL"],
        "name": "Token Name",
        "email": "token@example.test",
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def token(key=KEY, kid=KID, **overrides) -> str:
    return jwt.encode(claims(**overrides), key, algorithm="RS256", headers={"kid": kid})


def event(tok: str | None = None, headers: dict | None = None, forwarded: dict | None = None) -> dict:
    h = dict(headers or {})
    if tok is not None:
        h["Authorization"] = f"Bearer {tok}"
    return {"fieldName": "me", "request": {"headers": h}, "identity": {"claims": forwarded or {}}}


def test_valid_token_resolves_persona_and_subject():
    ident = resolve_identity(event(token()), settings(), StaticJwks())
    assert ident.subject == "cognito|sub-1"
    assert ident.persona == "msl" and ident.db_persona == "MSL"
    assert ident.token_source == "header"


def test_token_claims_win_over_request_fields():
    ev = event(token(), headers={"x-user-full-name": "Forged Name", "x-user-email": "forged@example.test"})
    ident = resolve_identity(ev, settings(), StaticJwks())
    assert ident.full_name == "Token Name"
    assert ident.email == "token@example.test"


def test_request_fields_fill_only_missing_claims():
    ev = event(token(name=None), headers={"x-user-full-name": "Okta Name"})
    assert resolve_identity(ev, settings(), StaticJwks()).full_name == "Okta Name"


@pytest.mark.parametrize(
    "tok",
    [
        pytest.param(lambda: token(exp=int(time.time()) - 3600, iat=int(time.time()) - 7200), id="expired"),
        pytest.param(lambda: token(aud="other-client"), id="wrong-audience"),
        pytest.param(lambda: token(iss="http://evil/pool"), id="wrong-issuer"),
        pytest.param(lambda: token(key=OTHER_KEY), id="bad-signature"),
        pytest.param(lambda: token(token_use="access"), id="access-token"),
        pytest.param(lambda: token()[:-4] + "AAAA", id="tampered"),
        pytest.param(lambda: jwt.encode(claims(), key=None, algorithm="none"), id="alg-none"),
        pytest.param(lambda: "not-a-jwt", id="garbage"),
    ],
)
def test_invalid_tokens_are_rejected(tok):
    with pytest.raises(Unauthorized):
        resolve_identity(event(tok()), settings(), StaticJwks())


def test_missing_token_is_rejected_outside_local():
    with pytest.raises(Unauthorized):
        resolve_identity(event(None, forwarded=claims()), settings(), StaticJwks())


def test_forwarded_identity_must_match_token_subject():
    with pytest.raises(Unauthorized):
        resolve_identity(event(token(), forwarded={"sub": "someone-else"}), settings(), StaticJwks())


@pytest.mark.parametrize(
    ("groups", "persona"),
    [(["Director"], "director"), (["Executive"], "executive"), (["Administrator"], "admin")],
)
def test_groups_map_to_personas(groups, persona):
    assert resolve_identity(event(token(**{"cognito:groups": groups})), settings(), StaticJwks()).persona == persona


@pytest.mark.parametrize("groups", [[], ["Unknown"], ["MSL", "Director"]])
def test_missing_or_ambiguous_persona_is_forbidden(groups):
    with pytest.raises(Forbidden):
        resolve_identity(event(token(**{"cognito:groups": groups})), settings(), StaticJwks())


def test_local_stand_in_accepts_forwarded_claims_with_checks():
    local = settings(A2G_ENV="local", A2G_TRUST_APPSYNC_IDENTITY="1")
    ident = resolve_identity(event(None, forwarded=claims()), local, StaticJwks())
    assert ident.token_source == "appsync-identity"
    for bad in (claims(aud="x"), claims(iss="http://evil"), claims(exp=int(time.time()) - 600), claims(token_use="access")):
        with pytest.raises(Unauthorized):
            resolve_identity(event(None, forwarded=bad), local, StaticJwks())


def test_local_stand_in_cannot_be_enabled_outside_local():
    with pytest.raises(RuntimeError):
        settings(A2G_TRUST_APPSYNC_IDENTITY="1")


def test_unknown_key_ids_do_not_trigger_a_fetch_each():
    jwks = StaticJwks()
    calls = []
    original = jwks._fetch

    def counting_fetch():
        calls.append(1)
        original()

    jwks._fetch = counting_fetch
    resolve_identity(event(token()), settings(), jwks)
    for _ in range(5):
        with pytest.raises(Unauthorized):
            resolve_identity(event(token(kid="made-up")), settings(), jwks)
    assert len(calls) == 1
