"""Build and deploy the BE API Lambda (``backend/lambdas/api``) into the BE account."""

from __future__ import annotations

import io
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

from .config import API_FUNCTION, BE_ACCOUNT, BUILD_DIR, FE_ACCOUNT, REPO, be

SRC_API = REPO / "backend" / "lambdas" / "api" / "src" / "a2g_api"
SRC_LOG = REPO / "backend" / "libs" / "a2g_logging" / "src" / "a2g_logging"
DEPS = ["psycopg[binary]>=3.2", "pyjwt[crypto]>=2.9"]


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
    code, arch = build()
    lam = be("lambda")
    env = {
        "Variables": {
            "A2G_ENV": "local",
            "A2G_COGNITO_ISSUER": fe["issuer"],
            "A2G_COGNITO_JWKS_URL": fe["jwks_url_internal"],
            "A2G_COGNITO_CLIENT_IDS": fe["client_id"],
            # floci's AppSync drops request headers; see docs/adr/0002.
            "A2G_TRUST_APPSYNC_IDENTITY": "1",
            "A2G_DB_DSN": db["app_dsn_internal"],
        }
    }
    try:
        lam.get_function(FunctionName=API_FUNCTION)
        exists = True
    except lam.exceptions.ResourceNotFoundException:
        exists = False
    if exists:
        lam.update_function_code(FunctionName=API_FUNCTION, ZipFile=code)
        _wait_updated(lam)
        lam.update_function_configuration(FunctionName=API_FUNCTION, Environment=env, Timeout=30, MemorySize=512)
        _wait_updated(lam)
    else:
        lam.create_function(
            FunctionName=API_FUNCTION,
            Runtime="python3.12",
            Handler="a2g_api.handler.handler",
            Role=f"arn:aws:iam::{BE_ACCOUNT}:role/a2g-be-api",
            Code={"ZipFile": code},
            Architectures=[arch],
            Timeout=30,
            MemorySize=512,
            Environment=env,
        )
    # Only the FE AppSync service may invoke this function (enforced by floci only when
    # IAM enforcement is on; it documents the real cross-account grant).
    try:
        lam.add_permission(
            FunctionName=API_FUNCTION,
            StatementId="fe-appsync-invoke",
            Action="lambda:InvokeFunction",
            Principal="appsync.amazonaws.com",
            SourceAccount=FE_ACCOUNT,
        )
    except lam.exceptions.ResourceConflictException:
        pass
    return lam.get_function(FunctionName=API_FUNCTION)["Configuration"]["FunctionArn"]


def _wait_updated(lam, timeout: float = 60) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        cfg = lam.get_function_configuration(FunctionName=API_FUNCTION)
        if cfg.get("LastUpdateStatus", "Successful") != "InProgress":
            return
        time.sleep(1)
