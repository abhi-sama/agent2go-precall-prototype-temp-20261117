"""RLS-scoped Postgres access.

The Lambda connects as ``app_user`` (non-owner, RLS forced on every table). Each request
runs in one transaction that first binds the verified caller with
``app.set_request_identity``; those settings are ``SET LOCAL``, so they vanish at commit
and a reused connection never carries one caller's scope into the next request.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator

import psycopg

from a2g_logging import get_logger

from .errors import Forbidden, Unavailable
from .identity import Identity

log = get_logger(__name__)

_conn: psycopg.Connection | None = None


def _connection(dsn: str) -> psycopg.Connection:
    global _conn
    if _conn is None or _conn.closed or _conn.broken:
        _conn = psycopg.connect(dsn, connect_timeout=5, application_name="a2g-be-api")
    return _conn


@contextlib.contextmanager
def scoped_cursor(dsn: str, identity: Identity, correlation_id: str) -> Iterator[tuple[psycopg.Cursor, str]]:
    """Yield ``(cursor, user_id)`` inside a transaction bound to the caller's scope.

    The verified token subject is mapped to an application user through the approved
    login-to-user mapping (``users.identity_subject``); an unmapped or unresolved login
    gets no data at all.
    """
    try:
        conn = _connection(dsn)
    except psycopg.Error as exc:
        log.error("database connect failed", error_type=type(exc).__name__)
        raise Unavailable("db_connect") from exc
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT app.resolve_user_id(%s)", (identity.subject,))
            row = cur.fetchone()
            user_id = row[0] if row else None
            if not user_id:
                raise Forbidden("identity_not_mapped")
            cur.execute(
                "SELECT app.set_request_identity(%s, %s, %s)",
                (user_id, identity.db_persona, correlation_id),
            )
            yield cur, user_id
    except psycopg.OperationalError as exc:
        log.error("database unavailable", error_type=type(exc).__name__)
        conn.close()
        raise Unavailable("db_operational") from exc


@contextlib.contextmanager
def user_cursor(dsn: str, user_id: str, persona: str, correlation_id: str) -> Iterator[psycopg.Cursor]:
    """Like ``scoped_cursor`` for work that continues on behalf of an already-resolved caller.

    The chat worker runs after the API Lambda verified the token and mapped the login to a user, so
    it binds that user directly. It still connects as ``app_user``: every statement stays under RLS.
    """
    try:
        conn = _connection(dsn)
    except psycopg.Error as exc:
        log.error("database connect failed", error_type=type(exc).__name__)
        raise Unavailable("db_connect") from exc
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT app.set_request_identity(%s, %s, %s)", (user_id, persona, correlation_id))
            yield cur
    except psycopg.OperationalError as exc:
        log.error("database unavailable", error_type=type(exc).__name__)
        conn.close()
        raise Unavailable("db_operational") from exc
