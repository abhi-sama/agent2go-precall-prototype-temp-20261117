"""BE account Postgres: floci RDS instance running the pgvector image."""

from __future__ import annotations

import os
import subprocess
import time

import psycopg

from .config import (
    APP_DB_PASSWORD,
    APP_DB_USER,
    DB_DIR,
    DB_NAME,
    INTERNAL_HOST,
    RDS_INSTANCE,
    RDS_MASTER_PASSWORD,
    RDS_MASTER_USER,
    be,
)


def _instance(rds) -> dict | None:
    try:
        return rds.describe_db_instances(DBInstanceIdentifier=RDS_INSTANCE)["DBInstances"][0]
    except rds.exceptions.DBInstanceNotFoundFault:
        return None


def _wait_connectable(port: int, timeout: float = 120) -> None:
    deadline = time.time() + timeout
    while True:
        try:
            with psycopg.connect(_dsn("postgres", port), connect_timeout=3):
                return
        except psycopg.OperationalError:
            if time.time() > deadline:
                raise
            time.sleep(2)


def _dsn(dbname: str, port: int, host: str = "localhost", user: str = RDS_MASTER_USER, password: str = RDS_MASTER_PASSWORD) -> str:
    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"


def provision(reseed: bool = True) -> dict:
    rds = be("rds")
    inst = _instance(rds)
    if inst is None:
        rds.create_db_instance(
            DBInstanceIdentifier=RDS_INSTANCE,
            Engine="postgres",
            EngineVersion="16",
            DBInstanceClass="db.t4g.medium",
            AllocatedStorage=20,
            MasterUsername=RDS_MASTER_USER,
            MasterUserPassword=RDS_MASTER_PASSWORD,
        )
        for _ in range(60):
            inst = _instance(rds)
            if inst and inst.get("DBInstanceStatus") == "available" and inst.get("Endpoint"):
                break
            time.sleep(2)
    assert inst is not None
    port = int(inst["Endpoint"]["Port"])
    _wait_connectable(port)

    if reseed:
        with psycopg.connect(_dsn("postgres", port), autocommit=True) as conn:
            conn.execute(f"DROP DATABASE IF EXISTS {DB_NAME} WITH (FORCE)")
            conn.execute(f"CREATE DATABASE {DB_NAME}")
        owner = _dsn(DB_NAME, port)
        env = {**os.environ, "DATABASE_URL": owner}
        subprocess.run([str(DB_DIR / "scripts" / "migrate.sh")], env=env, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["python3", str(DB_DIR / "seed" / "generate.py")], env=env, check=True)

    return {
        "port": port,
        "owner_dsn": _dsn(DB_NAME, port),
        "app_dsn_host": _dsn(DB_NAME, port, user=APP_DB_USER, password=APP_DB_PASSWORD),
        # Lambda containers sit on the compose network and reach the RDS proxy via floci.
        "app_dsn_internal": _dsn(DB_NAME, port, host=INTERNAL_HOST, user=APP_DB_USER, password=APP_DB_PASSWORD),
    }
