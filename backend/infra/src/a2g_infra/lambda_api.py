"""Build and deploy the BE API Lambda (``backend/lambdas/api``) into the BE account."""

from __future__ import annotations

import io
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

from .config import (
    AGENT_INTERNAL_URL,
    API_FUNCTION,
    BE_ACCOUNT,
    BUILD_DIR,
    CHAT_FUNCTION,
    FE_ACCOUNT,
    FLAGS_ROLE_ARN,
    FLAGS_TABLE,
    REPO,
    be,
)

SRC_API = REPO / "backend" / "lambdas" / "api" / "src" / "a2g_api"
SRC_LOG = REPO / "backend" / "libs" / "a2g_logging" / "src" / "a2g_logging"
DEPS = ["boto3>=1.35", "psycopg[binary]>=3.2", "pyjwt[crypto]>=2.9"]


def _arch() -> tuple[str, str]:
    """(pip platform, Lambda architecture) matching the Docker host that runs Lambda containers."""
    machine = subprocess.run(
        ["docker", "info", "--format", "{{.Architecture}}"], capture_output=True, text=True, check=True
    ).stdout.strip()
    if machine in ("aarch64", "arm64"):
        return "aarch64-manylinux_2_28", "arm64"
    return "x86_64-manylinux_2_28", "x86_64"


def build() -> tuple[bytes, str]:
    platform, arch = _arch()
    deps_dir = BUILD_DIR / f"lambda-deps-{arch}"
    if not deps_dir.exists():
        tmp = deps_dir.with_suffix(".tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        subprocess.run(
            ["uv", "pip", "install", "--quiet", "--target", str(tmp), "--python-platform", platform,
             "--python-version", "3.12", "--only-binary", ":all:", *DEPS],
            check=True,
        )
        tmp.rename(deps_dir)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, prefix in ((deps_dir, Path()), (SRC_API, Path("a2g_api")), (SRC_LOG, Path("a2g_logging"))):
            for f in sorted(root.rglob("*")):
                if f.is_file() and "__pycache__" not in f.parts:
                    zf.write(f, prefix / f.relative_to(root))
    return buf.getvalue(), arch


def deploy(fe: dict, db: dict) -> str:
    """Deploy the API Lambda and the chat worker (same code, different handler)."""
    code, arch = build()
    lam = be("lambda")
    shared = {
        "A2G_ENV": "local",
        "A2G_COGNITO_ISSUER": fe["issuer"],
        "A2G_COGNITO_JWKS_URL": fe["jwks_url_internal"],
        "A2G_COGNITO_CLIENT_IDS": fe["client_id"],
        # floci's AppSync drops request headers; see docs/adr/0002.
        "A2G_TRUST_APPSYNC_IDENTITY": "1",
        "A2G_DB_DSN": db["app_dsn_internal"],
        # FE DynamoDB flags, reached by assuming a narrow FE-account role (docs/adr/0006).
        "A2G_FLAGS_TABLE": FLAGS_TABLE,
        "A2G_FLAGS_ROLE_ARN": FLAGS_ROLE_ARN,
        "A2G_SAVED_VIEWS_TABLE": fe["saved_views_table"],
        "A2G_SAVED_VIEWS_ENDPOINT": "http://floci:4566",
        "A2G_SAVED_VIEWS_ACCESS_KEY": FE_ACCOUNT,
    }
    # The worker streams a chat run from the agent (AgentCore Runtime stand-in) into Postgres; the
    # API Lambda starts it asynchronously (docs/adr/0007).
    _upsert(
        lam, CHAT_FUNCTION, "a2g_api.chat_worker.handler", code, arch,
        {**shared, "A2G_AGENT_URL": AGENT_INTERNAL_URL}, timeout=300,
    )
    arn = _upsert(
        lam, API_FUNCTION, "a2g_api.handler.handler", code, arch,
        {**shared, "A2G_CHAT_WORKER_FUNCTION": CHAT_FUNCTION}, timeout=30,
    )
    return arn


def _upsert(lam, name: str, handler: str, code: bytes, arch: str, variables: dict[str, str], timeout: int) -> str:
    env = {"Variables": variables}
    try:
        lam.get_function(FunctionName=name)
        exists = True
    except lam.exceptions.ResourceNotFoundException:
        exists = False
    if exists:
        lam.update_function_code(FunctionName=name, ZipFile=code)
        _wait_updated(lam, name)
        lam.update_function_configuration(
            FunctionName=name, Handler=handler, Environment=env, Timeout=timeout, MemorySize=512
        )
        _wait_updated(lam, name)
    else:
        lam.create_function(
            FunctionName=name,
            Runtime="python3.12",
            Handler=handler,
            Role=f"arn:aws:iam::{BE_ACCOUNT}:role/{name}",
            Code={"ZipFile": code},
            Architectures=[arch],
            Timeout=timeout,
            MemorySize=512,
            Environment=env,
        )
    # Only the FE AppSync service may invoke the API function (enforced by floci only when
    # IAM enforcement is on; it documents the real cross-account grant). The worker is invoked
    # by the API function alone, inside the BE account.
    if name == API_FUNCTION:
        try:
            lam.add_permission(
                FunctionName=name,
                StatementId="fe-appsync-invoke",
                Action="lambda:InvokeFunction",
                Principal="appsync.amazonaws.com",
                SourceAccount=FE_ACCOUNT,
            )
        except lam.exceptions.ResourceConflictException:
            pass
    return lam.get_function(FunctionName=name)["Configuration"]["FunctionArn"]


def _wait_updated(lam, name: str, timeout: float = 60) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        cfg = lam.get_function_configuration(FunctionName=name)
        if cfg.get("LastUpdateStatus", "Successful") != "InProgress":
            return
        time.sleep(1)
