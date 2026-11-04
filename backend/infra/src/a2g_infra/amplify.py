"""Deploy the Amplify Gen2 backend (``frontend/amplify``) into floci.

``ampx sandbox`` deploys to real AWS, so it is never used. Instead the same backend
definition is synthesized offline into CloudFormation (exactly what ``ampx`` feeds the
CDK toolkit), its file assets are pushed to the CDK bootstrap bucket in floci S3, and
the root stack is created or updated through floci CloudFormation.
See docs/adr/0004-floci-local-stack.md for the spike behind this.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

from .config import (
    AMPLIFY_STACK,
    API_FUNCTION_ARN,
    BUILD_DIR,
    CDK_QUALIFIER,
    FE_ACCOUNT,
    FRONTEND,
    REGION,
    WEB_ORIGIN,
    fe,
    floci_env,
)

CDK_OUT = BUILD_DIR / "cdk.out"
ASSET_BUCKET = f"cdk-{CDK_QUALIFIER}-assets-{FE_ACCOUNT}-{REGION}"


def synth() -> Path:
    shutil.rmtree(CDK_OUT, ignore_errors=True)
    env = floci_env(FE_ACCOUNT)
    env.update(
        CDK_OUTDIR=str(CDK_OUT),
        CDK_DEFAULT_ACCOUNT=FE_ACCOUNT,
        CDK_DEFAULT_REGION=REGION,
        CDK_CONTEXT_JSON=json.dumps(
            {
                "amplify-backend-namespace": "agent2go",
                "amplify-backend-name": "local",
                "amplify-backend-type": "sandbox",
            }
        ),
        A2G_DEPLOY_TARGET="floci",
        A2G_BE_API_LAMBDA_ARN=API_FUNCTION_ARN,
        A2G_WEB_ORIGINS=WEB_ORIGIN,
        NODE_NO_WARNINGS="1",
    )
    subprocess.run(["pnpm", "exec", "tsx", "amplify/backend.ts"], cwd=FRONTEND, env=env, check=True)
    return CDK_OUT


def _upload_assets(out: Path) -> None:
    s3 = fe("s3")
    try:
        s3.create_bucket(Bucket=ASSET_BUCKET)
    except (s3.exceptions.BucketAlreadyOwnedByYou, s3.exceptions.BucketAlreadyExists):
        pass
    fe("ssm").put_parameter(Name=f"/cdk-bootstrap/{CDK_QUALIFIER}/version", Value="27", Type="String", Overwrite=True)
    manifest = json.loads(next(out.glob("*.assets.json")).read_text())
    for asset in manifest.get("files", {}).values():
        src = out / asset["source"]["path"]
        key = next(iter(asset["destinations"].values()))["objectKey"]
        if asset["source"].get("packaging") == "zip":
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for f in sorted(src.rglob("*")):
                    if f.is_file():
                        zf.write(f, f.relative_to(src))
            body = buf.getvalue()
        else:
            body = src.read_bytes()
        s3.put_object(Bucket=ASSET_BUCKET, Key=key, Body=body)


def _status(cfn) -> str | None:
    try:
        return cfn.describe_stacks(StackName=AMPLIFY_STACK)["Stacks"][0]["StackStatus"]
    except cfn.exceptions.ClientError:
        return None


def _wait(cfn) -> str:
    for _ in range(120):
        status = _status(cfn) or "DELETE_COMPLETE"
        if not status.endswith("IN_PROGRESS"):
            return status
        time.sleep(2)
    raise SystemExit("Amplify stack did not settle in floci CloudFormation")


def deploy() -> dict:
    out = synth()
    _upload_assets(out)
    cfn = fe("cloudformation")
    template = next(p for p in out.glob("amplify-*.template.json")).read_text()
    caps = ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM", "CAPABILITY_AUTO_EXPAND"]

    status = _status(cfn)
    if status and status not in ("CREATE_COMPLETE", "UPDATE_COMPLETE"):
        # A failed or rolled-back stack cannot be updated: start over.
        cfn.delete_stack(StackName=AMPLIFY_STACK)
        _wait(cfn)
        status = None
    if status is None:
        cfn.create_stack(StackName=AMPLIFY_STACK, TemplateBody=template, Capabilities=caps)
    else:
        try:
            cfn.update_stack(StackName=AMPLIFY_STACK, TemplateBody=template, Capabilities=caps)
        except cfn.exceptions.ClientError as exc:
            if "No updates" not in str(exc):
                raise
    final = _wait(cfn)
    if final not in ("CREATE_COMPLETE", "UPDATE_COMPLETE"):
        raise SystemExit(f"Amplify stack ended in {final}; see `docker logs floci`")

    outs = {o["OutputKey"]: o["OutputValue"] for o in cfn.describe_stacks(StackName=AMPLIFY_STACK)["Stacks"][0].get("Outputs", [])}
    custom = json.loads(outs.get("customOutputs") or "{}")
    data = custom.get("data") or {}
    pool_id = outs["userPoolId"]
    graphql_url = data["url"]
    return {
        "user_pool_id": pool_id,
        "client_id": outs["webClientId"],
        "region": outs.get("authRegion", REGION),
        "groups": json.loads(outs.get("groups") or "[]"),
        "graphql_url": graphql_url,
        # floci names itself by FLOCI_HOSTNAME; the browser and tests reach it on localhost.
        "graphql_url_host": graphql_url.replace("http://floci:4566", os.environ.get("A2G_FLOCI_ENDPOINT", "http://localhost:4566")),
        "issuer": f"http://floci:4566/{pool_id}",
        "jwks_url_internal": f"http://floci:4566/{pool_id}/.well-known/jwks.json",
        "outputs": outs,
    }
