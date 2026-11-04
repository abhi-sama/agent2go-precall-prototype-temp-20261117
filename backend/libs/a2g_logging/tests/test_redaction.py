"""Proves that tokens, emails, names and HCP free text never reach a log line."""

from __future__ import annotations

import io
import json
import logging

import pytest

from a2g_logging import configure, correlation, get_logger, sanitize_fields, scrub

TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhYmMiLCJlbWFpbCI6Im1AZXhhbXBsZS50ZXN0In0.c2lnbmF0dXJl"
EMAIL = "priya.raman@example.test"
NAME = "Priya Raman"
HCP_TEXT = "Dr Okafor prefers the 2L regimen for EGFR+ patients after progression"
SECRETS = [TOKEN, EMAIL, NAME, HCP_TEXT, "Priya", "Okafor", "hunter2", "sk-ant-local-key"]


@pytest.fixture
def lines():
    buf = io.StringIO()
    configure(service="test-service", level=logging.DEBUG, stream=buf)

    def read() -> list[dict]:
        return [json.loads(line) for line in buf.getvalue().splitlines() if line.strip()]

    return read


def assert_clean(records: list[dict]) -> None:
    text = json.dumps(records)
    for secret in SECRETS:
        assert secret not in text, f"leaked {secret!r}"


def test_contract_fields(lines):
    with correlation("corr-123"):
        get_logger("t").info("kpis served", persona="msl", count=3)
    (rec,) = lines()
    assert {"ts", "level", "msg", "correlation_id", "service"} <= rec.keys()
    assert rec["correlation_id"] == "corr-123"
    assert rec["service"] == "test-service"
    assert rec["level"] == "info"
    assert rec["persona"] == "msl" and rec["count"] == 3


def test_disallowed_fields_are_dropped(lines):
    get_logger("t").info(
        "request received",
        email=EMAIL,
        full_name=NAME,
        authorization=f"Bearer {TOKEN}",
        rspns_txt=HCP_TEXT,
        headers={"x-user-name": NAME},
        user_id="msl-t01-01",
    )
    (rec,) = lines()
    assert rec["user_id"] == "msl-t01-01"
    for key in ("email", "full_name", "authorization", "rspns_txt", "headers"):
        assert key not in rec
    assert_clean([rec])


def test_allowed_string_values_and_messages_are_scrubbed(lines):
    log = get_logger("t")
    log.warning(f"token rejected {TOKEN} for {EMAIL}", error_code=f"Bearer {TOKEN}", status=EMAIL)
    log.info("dsn postgresql://app_user:hunter2@db:5432/agent2go and api_key=sk-ant-local-key")
    assert_clean(lines())


def test_container_values_are_never_emitted(lines):
    get_logger("t").info("x", operation={"name": NAME}, count=[EMAIL])
    (rec,) = lines()
    assert "operation" not in rec and "count" not in rec


def test_exception_messages_are_never_written(lines):
    log = get_logger("t")
    try:
        raise ValueError(f"duplicate key (email)=({EMAIL}) name {NAME}: {HCP_TEXT}")
    except ValueError:
        log.exception("insert failed")
    (rec,) = lines()
    assert rec["error_type"] == "ValueError"
    assert "test_redaction.py" in rec["error_at"]
    assert_clean([rec])


def test_third_party_loggers_lose_interpolated_args(lines):
    # Libraries log with %-args; the formatter writes only the template.
    logging.getLogger("some.library").warning("response body: %s from %s", HCP_TEXT, EMAIL)
    logging.getLogger("other").error("auth header %r", f"Bearer {TOKEN}")
    records = lines()
    assert len(records) == 2
    assert_clean(records)


def test_correlation_id_rejects_free_text():
    with correlation(f"{NAME} {EMAIL}") as cid:
        assert NAME not in cid and "@" not in cid
    with correlation("ok-id_1.2:3") as cid:
        assert cid == "ok-id_1.2:3"


def test_sanitize_and_scrub_helpers():
    assert sanitize_fields({"persona": "msl", "email": EMAIL, "count": None}) == {"persona": "msl", "count": None}
    assert "[redacted]" in scrub(f"x {EMAIL} y")
    assert len(scrub("a" * 500)) <= 121
