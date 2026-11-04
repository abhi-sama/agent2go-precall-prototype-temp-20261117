"""Fixed names and endpoints for the local stack. Local-only values; nothing here is a secret."""

from __future__ import annotations

import os
from pathlib import Path

import boto3

REPO = Path(__file__).resolve().parents[4]
INFRA = REPO / "backend" / "infra"
STATE_DIR = INFRA / ".state"
BUILD_DIR = INFRA / "build"
FRONTEND = REPO / "frontend"
DB_DIR = REPO / "backend" / "db"
SEED_USERS = DB_DIR / "seed-users.json"

REGION = "us-east-1"
FE_ACCOUNT = "111111111111"
BE_ACCOUNT = "222222222222"

#: Host-side floci endpoint. Every SDK call in this package goes here; nothing reaches AWS.
ENDPOINT = os.environ.get("A2G_FLOCI_ENDPOINT", "http://localhost:4566")
#: How containers on the compose network (Lambda) reach floci.
INTERNAL_HOST = "floci"
INTERNAL_ENDPOINT = f"http://{INTERNAL_HOST}:4566"

RDS_INSTANCE = "a2g-be-postgres"
RDS_MASTER_USER = "postgres"
RDS_MASTER_PASSWORD = "postgres-local-only"
DB_NAME = "agent2go"
#: Created by backend/db/migrations/003_rls.sql with a local-only password.
APP_DB_USER = "app_user"
APP_DB_PASSWORD = "app_user"

API_FUNCTION = "a2g-be-api"
API_FUNCTION_ARN = f"arn:aws:lambda:{REGION}:{BE_ACCOUNT}:function:{API_FUNCTION}"
#: Long-running worker that streams one chat run from the agent into Postgres (docs/adr/0007).
CHAT_FUNCTION = "a2g-be-chat"

#: FE-account resources the agent's narrow write tool uses (frontend/amplify/storage/resource.ts; docs/adr/0005).
FE_CHAT_TABLE = "a2g-chat-turns"
FE_CHAT_WRITER_ROLE_ARN = f"arn:aws:iam::{FE_ACCOUNT}:role/a2g-agent-chat-writer"

COMPOSE_FILE = INFRA / "docker-compose.yml"
#: Host port of the agent container, and its name for containers on the compose network.
AGENT_HOST_PORT = int(os.environ.get("A2G_AGENT_PORT", "8080"))
AGENT_INTERNAL_URL = "http://agent:8080"

#: FE DynamoDB flags table and the narrow FE-account role the BE Lambda assumes
#: (frontend/amplify/storage/resource.ts defines both; docs/adr/0006).
FLAGS_TABLE = "a2g-feedback-flags"
FLAGS_ROLE_ARN = f"arn:aws:iam::{FE_ACCOUNT}:role/a2g-be-flags"

AMPLIFY_STACK = "amplify-agent2go-local-sandbox"
CDK_QUALIFIER = "hnb659fds"

WEB_ORIGIN = os.environ.get("A2G_WEB_ORIGIN", "http://localhost:3210")
#: Password for every seeded Cognito user. Local stack only.
LOCAL_PASSWORD = os.environ.get("A2G_LOCAL_PASSWORD", "Agent2go-local-1")


def client(service: str, account: str):
    """A boto3 client pinned to floci, signed as the given emulated account.

    floci picks the account from the 12-digit access key id; the secret is ignored.
    """
    return boto3.client(
        service,
        endpoint_url=ENDPOINT,
        region_name=REGION,
        aws_access_key_id=account,
        aws_secret_access_key="test",
    )


def fe(service: str):
    return client(service, FE_ACCOUNT)


def be(service: str):
    return client(service, BE_ACCOUNT)


def floci_env(account: str) -> dict[str, str]:
    """Environment for subprocesses (aws CLI, CDK synth) pinned to floci."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("AWS_")}
    env.update(
        AWS_ENDPOINT_URL=ENDPOINT,
        AWS_ACCESS_KEY_ID=account,
        AWS_SECRET_ACCESS_KEY="test",
        AWS_REGION=REGION,
        AWS_DEFAULT_REGION=REGION,
    )
    return env
