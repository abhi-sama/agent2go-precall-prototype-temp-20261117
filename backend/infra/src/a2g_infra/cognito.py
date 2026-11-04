"""Seeded Cognito users (FE account) and the approved login-to-user mapping (BE Postgres).

One Cognito user per entry in ``backend/db/seed-users.json``. Persona = the entry's
Cognito group. After the user exists, its token subject is recorded in
``users.identity_subject`` as ``cognito|<sub>``: that row is the governed mapping the
BE uses to turn a verified token into an application user. The user that the seed marks
``unresolved`` keeps its status, so signing in as it yields no data (planted defect).
"""

from __future__ import annotations

import json

import psycopg

from .config import LOCAL_PASSWORD, SEED_USERS
from .config import fe as fe_client

FIRST = ["Avery", "Jordan", "Riley", "Morgan", "Taylor", "Casey", "Cameron", "Quinn", "Rowan", "Sage", "Emerson", "Hayden"]
LAST = ["Okafor", "Lindqvist", "Moreau", "Tanaka", "Haddad", "Novak", "Castillo", "Mensah", "Ibarra", "Kowalski"]


def synthetic_name(index: int) -> str:
    return f"{FIRST[index % len(FIRST)]} {LAST[(index * 7) % len(LAST)]}"


def _ensure_user(idp, pool_id: str, email: str, full_name: str, group: str) -> str:
    try:
        user = idp.admin_get_user(UserPoolId=pool_id, Username=email)
    except idp.exceptions.UserNotFoundException:
        user = idp.admin_create_user(
            UserPoolId=pool_id,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "name", "Value": full_name},
            ],
            MessageAction="SUPPRESS",
        )["User"]
    idp.admin_set_user_password(UserPoolId=pool_id, Username=email, Password=LOCAL_PASSWORD, Permanent=True)
    current = {g["GroupName"] for g in idp.admin_list_groups_for_user(UserPoolId=pool_id, Username=email)["Groups"]}
    for stale in current - {group}:
        idp.admin_remove_user_from_group(UserPoolId=pool_id, Username=email, GroupName=stale)
    if group not in current:
        idp.admin_add_user_to_group(UserPoolId=pool_id, Username=email, GroupName=group)
    attrs = user.get("UserAttributes") or user.get("Attributes") or []
    return next(a["Value"] for a in attrs if a["Name"] == "sub")


def seed_users(fe: dict, db: dict) -> list[dict]:
    manifest = json.loads(SEED_USERS.read_text())["users"]
    idp = fe_client("cognito-idp")
    pool_id = fe["user_pool_id"]
    seeded = []
    with psycopg.connect(db["owner_dsn"]) as conn:
        for index, row in enumerate(manifest):
            full_name = synthetic_name(index)
            sub = _ensure_user(idp, pool_id, row["email"], full_name, row["cognito_group"])
            conn.execute(
                "UPDATE users SET identity_subject = %s WHERE user_id = %s",
                (f"cognito|{sub}", row["user_id"]),
            )
            status = conn.execute("SELECT identity_status FROM users WHERE user_id = %s", (row["user_id"],)).fetchone()
            seeded.append(
                {
                    "user_id": row["user_id"],
                    "email": row["email"],
                    "full_name": full_name,
                    "cognito_group": row["cognito_group"],
                    "territory_id": row["territory_id"],
                    "identity_status": status[0] if status else None,
                }
            )
    return seeded
