"""Every field the handler routes must resolve to a real callable, and every API field must be routed.

Guards against a merge or rebase silently dropping a resolver (the handler map names
``resolvers.hcp_profile`` lazily, so a missing function only fails once the Lambda initialises).
"""

from __future__ import annotations

import re
from pathlib import Path

from a2g_api import handler
from a2g_api.settings import Settings

SCHEMA = Path(__file__).resolve().parents[4] / "frontend" / "amplify" / "data" / "schema.graphql"
# Resolved by AppSync itself (IAM, server-to-server), never routed through the BE API Lambda.
NOT_BE_FIELDS = {"publishChatEvent"}


def _settings() -> Settings:
    return Settings.from_env(
        {
            "A2G_ENV": "local",
            "A2G_COGNITO_ISSUER": "http://issuer.test",
            "A2G_COGNITO_CLIENT_IDS": "client",
            "A2G_DB_DSN": "postgresql://unused",
        }
    )


def _schema_fields(type_name: str) -> set[str]:
    body = re.search(rf"^type {type_name} \{{\n(.*?)^\}}", SCHEMA.read_text(), re.S | re.M)
    assert body, f"{type_name} not found in {SCHEMA}"
    lines = body.group(1).splitlines()
    return {m.group(1) for line in lines if (m := re.match(r"  (\w+)\s*[(:]", line))}


def test_every_routed_field_is_a_callable():
    routed = handler._resolvers(_settings(), "test-correlation")
    assert routed
    not_callable = sorted(name for name, fn in routed.items() if not callable(fn))
    assert not_callable == []


def test_every_schema_field_has_a_resolver():
    fields = (_schema_fields("Query") | _schema_fields("Mutation")) - NOT_BE_FIELDS
    assert {"hcpProfile", "searchHcps", "me"} <= fields  # the parser really read the schema
    missing = sorted(fields - set(handler._resolvers(_settings(), "test-correlation")))
    assert missing == []


def test_every_routed_field_exists_in_the_schema():
    fields = _schema_fields("Query") | _schema_fields("Mutation")
    extra = sorted(set(handler._resolvers(_settings(), "test-correlation")) - fields)
    assert extra == []
