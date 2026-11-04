"""Provision the local stack on floci, idempotently.

Order matters:

1. BE account: RDS Postgres (pgvector image), fresh ``agent2go`` database, migrations, seed.
2. FE account: the Amplify Gen2 backend in ``frontend/amplify`` is synthesized offline
   and deployed through floci CloudFormation (Cognito user pool + groups, AppSync API
   whose resolvers call the BE Lambda cross-account).
3. BE account: the API Lambda, configured with the FE user pool's issuer and client.
4. FE account: one Cognito user per seeded application user, plus the approved
   login-to-user mapping written to ``users.identity_subject``.
5. Outputs for the frontend (``frontend/amplify_outputs.json``, ``frontend/.env.local``)
   and for tests (``backend/infra/.state/outputs.json``).

Every AWS call is made against floci with test credentials (see ``config.client``).
"""

from __future__ import annotations

import argparse
import json
import time

from a2g_logging import configure, correlation, get_logger

from . import agent_stack, amplify, cognito, database, lambda_api, outputs
from .config import ENDPOINT

log = get_logger("a2g_infra.provision")


def wait_for_floci(timeout: float = 90) -> None:
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{ENDPOINT}/_floci/health", timeout=3) as resp:
                if resp.status == 200:
                    return
        except OSError:
            pass
        time.sleep(1)
    raise SystemExit(f"floci did not become healthy at {ENDPOINT}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision the local agent2go stack on floci")
    parser.add_argument("--skip-seed", action="store_true", help="keep the existing database instead of reseeding")
    args = parser.parse_args()

    configure(service="a2g-infra")
    with correlation(None):
        wait_for_floci()
        print("1/6 BE: Postgres (RDS, pgvector) + migrations + seed")
        db = database.provision(reseed=not args.skip_seed)
        print("2/6 FE: Amplify Gen2 backend -> floci CloudFormation (Cognito, AppSync)")
        fe = amplify.deploy()
        print("3/6 FE: conversation store + the agent's narrow write role (deployed with the Amplify backend)")
        store = agent_stack.fe_store()
        print("4/6 BE: agent container (AgentCore Runtime stand-in)")
        agent = agent_stack.deploy_agent(db=db, store=store)
        print("5/6 BE: API Lambda + chat worker")
        fn_arn = lambda_api.deploy(fe=fe, db=db)
        print("6/6 FE: seeded Cognito users + login-to-user mapping, outputs")
        users = cognito.seed_users(fe=fe, db=db)
        outputs.write(fe=fe, db=db, fn_arn=fn_arn, users=users, store=store, agent=agent)
        log.info("local stack provisioned", count=len(users))
        print(json.dumps({"graphql": fe["graphql_url_host"], "userPoolId": fe["user_pool_id"], "users": len(users)}))


if __name__ == "__main__":
    main()
