"""API-as-persona harness.

A test acts exactly like the browser: a seeded persona signs in to Cognito (SRP, the
flow Amplify uses), then calls the FE AppSync GraphQL API with its ID token. Assertions
are made only on what the API returns. Admin-side helpers (owner database access,
direct BE Lambda invocation, Lambda logs) exist to arrange state and to inspect the BE
from outside, never to bypass the API under test.

Requires the local stack: ``backend/infra/scripts/up.sh``.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any

import boto3
import psycopg
from pycognito.aws_srp import AWSSRP

REPO = Path(__file__).resolve().parents[2]
STATE = REPO / "backend" / "infra" / ".state" / "outputs.json"

ME = "query Me { me { userId fullName email persona scopeLabel } }"
LANDING_KPIS = """
query LandingKpis($from: AWSDate, $to: AWSDate) {
  landingKpis(from: $from, to: $to) {
    distinctCalls distinctEngagedHcps responseCount from to dataThrough scopeLabel
  }
}
"""


@cache
def state() -> dict[str, Any]:
    if not STATE.exists():
        raise RuntimeError("local stack not provisioned: run backend/infra/scripts/up.sh")
    return json.loads(STATE.read_text())


def _client(service: str, account: str):
    return boto3.client(
        service,
        endpoint_url=state()["endpoint"],
        region_name="us-east-1",
        aws_access_key_id=account,
        aws_secret_access_key="test",
    )


def seeded_user(user_id: str) -> dict[str, Any]:
    return next(u for u in state()["users"] if u["user_id"] == user_id)


def sign_in(email: str, password: str | None = None) -> dict[str, str]:
    """Cognito USER_SRP_AUTH, returning the AuthenticationResult tokens."""
    fe = state()["fe"]
    idp = _client("cognito-idp", "111111111111")
    srp = AWSSRP(
        username=email,
        password=password or state()["local_password"],
        pool_id=fe["user_pool_id"],
        client_id=fe["client_id"],
        client=idp,
    )
    init = idp.initiate_auth(AuthFlow="USER_SRP_AUTH", AuthParameters=srp.get_auth_params(), ClientId=fe["client_id"])
    answer = srp.process_challenge(init["ChallengeParameters"], srp.get_auth_params())
    # Real Cognito tolerates a missing Session here; floci requires it (Amplify JS sends it).
    out = idp.respond_to_auth_challenge(
        ClientId=fe["client_id"],
        ChallengeName="PASSWORD_VERIFIER",
        ChallengeResponses=answer,
        Session=init.get("Session"),
    )
    return out["AuthenticationResult"]


@dataclass
class GraphQLResult:
    status: int
    data: dict[str, Any] | None
    errors: list[dict[str, Any]] = field(default_factory=list)

    @property
    def error_types(self) -> list[str]:
        return [str(e.get("errorType", "")) for e in self.errors]


def graphql(query: str, variables: dict | None = None, token: str | None = None, headers: dict | None = None) -> GraphQLResult:
    h = {"content-type": "application/json", "x-correlation-id": str(uuid.uuid4())}
    if token:
        h["authorization"] = f"Bearer {token}"
    h.update(headers or {})
    # floci's GraphQL executor fails on explicit null variables; omitting an optional
    # variable means the same thing in GraphQL. The frontend transport does the same.
    variables = {k: v for k, v in (variables or {}).items() if v is not None}
    payload = json.dumps({"query": query, "variables": variables}).encode()
    # floci runs AppSync's GraphQL executor as a sidecar container that can be recreated or still
    # warming up; that infrastructure error (never an application error) is retried.
    for attempt in range(4):
        req = urllib.request.Request(state()["fe"]["graphql_url_host"], data=payload, headers=h, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body, status = json.load(resp), resp.status
        except urllib.error.HTTPError as exc:
            body, status = json.loads(exc.read() or b"{}"), exc.code
        sidecar_down = any("sidecar" in str(e.get("message", "")) for e in body.get("errors") or [])
        if not sidecar_down or attempt == 3:
            break
        time.sleep(3)
    return GraphQLResult(status, body.get("data"), body.get("errors") or [])


@dataclass
class Persona:
    """A seeded user signed in through Cognito, calling the API like the browser does."""

    user_id: str
    tokens: dict[str, str]

    @classmethod
    def sign_in(cls, user_id: str) -> Persona:
        return cls(user_id, sign_in(seeded_user(user_id)["email"]))

    @property
    def id_token(self) -> str:
        return self.tokens["IdToken"]

    def query(self, query: str, variables: dict | None = None, headers: dict | None = None) -> GraphQLResult:
        return graphql(query, variables, token=self.id_token, headers=headers)

    def me(self, headers: dict | None = None) -> dict[str, Any]:
        res = self.query(ME, headers=headers)
        assert not res.errors, res.errors
        return res.data["me"]

    def landing_kpis(self, frm: str | None = None, to: str | None = None) -> GraphQLResult:
        return self.query(LANDING_KPIS, {"from": frm, "to": to})


def invoke_be_lambda(event: dict[str, Any]) -> dict[str, Any]:
    """Invoke the BE API Lambda directly, as AppSync does in AWS (with request headers)."""
    lam = _client("lambda", "222222222222")
    out = lam.invoke(FunctionName="a2g-be-api", Payload=json.dumps(event).encode())
    payload = json.loads(out["Payload"].read() or b"null")
    return {"error": out.get("FunctionError"), "payload": payload}


def owner_db() -> psycopg.Connection:
    """Owner connection for arranging state and computing ground truth. Bypasses RLS."""
    return psycopg.connect(state()["be"]["owner_dsn"], autocommit=True)


def be_lambda_logs(since: str = "10m") -> str:
    """Everything the BE Lambda wrote to stdout, as floci captured it."""
    container = os.environ.get("A2G_FLOCI_CONTAINER", "floci")
    out = subprocess.run(["docker", "logs", "--since", since, container], capture_output=True, text=True, check=True)
    lines = (out.stdout + out.stderr).splitlines()
    return "\n".join(line for line in lines if "[lambda:a2g-be-api" in line)
