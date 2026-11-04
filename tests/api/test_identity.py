"""Identity: the token is verified, and token claims win over request-supplied fields.

Through floci's AppSync the Lambda receives AppSync-verified claims (floci drops request
headers; docs/adr/0002). Invoking the BE Lambda directly with the headers AWS AppSync
forwards exercises the Lambda's own token verification: RS256 signature against the
pool JWKS, issuer, audience, expiry and token_use.
"""

from __future__ import annotations

import base64
import json

from harness import invoke_be_lambda, seeded_user

FORGED = {"x-user-full-name": "Mallory Forged", "x-user-email": "mallory@evil.test"}


def test_claims_win_over_request_fields_through_appsync(msl):
    me = msl.me(headers=FORGED)
    user = seeded_user("msl-t01-01")
    assert me["userId"] == "msl-t01-01"
    assert me["email"] == user["email"]
    assert me["fullName"] == user["full_name"]
    assert me["persona"] == "msl"


def _event(token: str, extra_headers: dict | None = None) -> dict:
    return {
        "fieldName": "me",
        "arguments": {},
        "identity": {},
        "request": {"headers": {"authorization": f"Bearer {token}", **(extra_headers or {})}},
    }


def test_lambda_verifies_the_raw_token_and_claims_win(msl):
    out = invoke_be_lambda(_event(msl.id_token, FORGED))
    assert out["error"] is None, out
    user = seeded_user("msl-t01-01")
    assert out["payload"]["email"] == user["email"]
    assert out["payload"]["fullName"] == user["full_name"]


def _tamper(token: str, **claims) -> str:
    head, body, sig = token.split(".")
    payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    payload.update(claims)
    forged = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"{head}.{forged}.{sig}"


def test_lambda_rejects_tampered_tokens(msl):
    for token in (
        _tamper(msl.id_token, **{"cognito:groups": ["Administrator"]}),
        _tamper(msl.id_token, email="mallory@evil.test"),
        msl.id_token.rsplit(".", 1)[0] + ".c2lnbmF0dXJl",
    ):
        out = invoke_be_lambda(_event(token))
        assert out["payload"]["__a2gError"]["type"] == "Unauthorized", "tampered token was accepted"


def test_lambda_rejects_access_tokens(msl):
    # Access tokens carry no email/name claims, so they cannot satisfy claims-win.
    out = invoke_be_lambda(_event(msl.tokens["AccessToken"]))
    assert out["payload"]["__a2gError"]["type"] == "Unauthorized"
