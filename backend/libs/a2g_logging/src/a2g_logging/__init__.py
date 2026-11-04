"""Structured JSON logging for agent2go backend services.

Every line is one JSON object with ``ts``, ``level``, ``msg``, ``correlation_id`` and
``service`` (foundation contract), plus allowlisted fields.

Privacy is enforced by an ALLOWLIST, not a denylist, mirroring the frontend logger:

* A structured field is emitted only if its key is in ``ALLOWED_FIELDS`` and its value
  is a short scalar. Tokens, emails, names and HCP free text have no key that passes.
* Messages and allowed string values are scrubbed for JWT, bearer-token and email shapes.
* Exceptions are logged as their type and code location only. Exception messages can
  carry row values (a database error quoting a key, an HTTP error echoing a body), so
  they are never written.
* Records from third-party loggers go through the same formatter, so a library that
  logs a request body or a DSN is scrubbed and stripped of its interpolated arguments.

Usage::

    from a2g_logging import configure, get_logger, correlation

    configure(service="be-api")
    log = get_logger(__name__)
    with correlation("4f1c..."):
        log.info("landing kpis served", extra={"fields": {"persona": "msl", "count": 3}})
"""

from __future__ import annotations

import contextlib
import contextvars
import datetime as _dt
import json
import logging
import re
import sys
import traceback
import uuid
from collections.abc import Iterator, Mapping
from typing import Any

__all__ = [
    "ALLOWED_FIELDS",
    "JsonFormatter",
    "configure",
    "correlation",
    "current_correlation_id",
    "get_logger",
    "new_correlation_id",
    "sanitize_fields",
    "scrub",
]

#: The only structured keys that may reach a log line. Ids, counts, durations, enums.
#: Extend deliberately and never with a key that could hold free text or personal data.
ALLOWED_FIELDS: frozenset[str] = frozenset(
    {
        "operation",
        "field_name",
        "persona",
        "user_id",
        "territory_id",
        "territory_count",
        "status",
        "outcome",
        "error_code",
        "error_type",
        "duration_ms",
        "count",
        "row_count",
        "kpi_distinct_calls",
        "kpi_distinct_hcps",
        "kpi_responses",
        "range_days",
        "request_id",
        "thread_id",
        "run_id",
        "tool",
        "model_id",
        "token_source",
        "cold_start",
        "attempt",
        "stage",
        "account",
        "resource",
    }
)

MAX_VALUE_LENGTH = 120

_JWT = re.compile(r"eyJ[\w-]+\.[\w-]+\.[\w-]*")
_BEARER = re.compile(r"\b(bearer|basic)\s+[\w.~+/=-]+", re.IGNORECASE)
_EMAIL = re.compile(r"[^\s@\"'<>(),;:]+@[^\s@\"'<>(),;:]+\.[^\s@\"'<>(),;:]+")
_DSN_SECRET = re.compile(r"(://[^:/\s]+:)[^@\s]+@")
_KV_SECRET = re.compile(r"\b(password|passwd|pwd|secret|token|api[_-]?key)=\S+", re.IGNORECASE)

REDACTED = "[redacted]"

_correlation_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "a2g_correlation_id", default=None
)
_service_name = "agent2go-backend"


def scrub(value: str) -> str:
    """Remove token, email and credential shapes from a string and cap its length."""
    out = _JWT.sub(REDACTED, value)
    out = _BEARER.sub(REDACTED, out)
    out = _EMAIL.sub(REDACTED, out)
    out = _DSN_SECRET.sub(rf"\1{REDACTED}@", out)
    out = _KV_SECRET.sub(lambda m: f"{m.group(1)}={REDACTED}", out)
    if len(out) > MAX_VALUE_LENGTH:
        out = out[:MAX_VALUE_LENGTH] + "…"
    return out


def _scalar(value: Any) -> str | int | float | bool | None:
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        return scrub(value)
    # Containers, objects and bytes could carry anything: never emit them.
    return None


def sanitize_fields(fields: Mapping[str, Any] | None) -> dict[str, Any]:
    """Keep only allowlisted keys with scalar values, scrubbing string values."""
    out: dict[str, Any] = {}
    for key, value in (fields or {}).items():
        if key not in ALLOWED_FIELDS:
            continue
        clean = _scalar(value)
        if clean is None and value is not None:
            continue
        out[key] = clean
    return out


def new_correlation_id() -> str:
    return str(uuid.uuid4())


def current_correlation_id() -> str:
    """The active correlation id, creating one for this context if none is set."""
    cid = _correlation_id.get()
    if cid is None:
        cid = new_correlation_id()
        _correlation_id.set(cid)
    return cid


_CORRELATION_SHAPE = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


@contextlib.contextmanager
def correlation(correlation_id: str | None) -> Iterator[str]:
    """Bind a correlation id for the duration of a request.

    An incoming id that is not a short opaque token is replaced, so a caller cannot
    smuggle free text or personal data into every log line through this header.
    """
    cid = correlation_id if correlation_id and _CORRELATION_SHAPE.match(correlation_id) else None
    token = _correlation_id.set(cid or new_correlation_id())
    try:
        yield _correlation_id.get()  # type: ignore[misc]
    finally:
        _correlation_id.reset(token)


def _exception_fields(exc_info: Any) -> dict[str, Any]:
    exc_type, _exc, tb = exc_info
    frames = traceback.extract_tb(tb)[-5:] if tb else []
    where = ";".join(f"{f.filename.rsplit('/', 1)[-1]}:{f.lineno}:{f.name}" for f in frames)
    return {"error_type": getattr(exc_type, "__name__", "Exception"), "error_at": where[:400]}


class JsonFormatter(logging.Formatter):
    """Formats every record (ours or third-party) as one redacted JSON line."""

    def __init__(self, service: str) -> None:
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        # Use the raw template, never the %-interpolated message: interpolated
        # arguments are where third-party libraries put bodies, SQL params and DSNs.
        template = record.msg if isinstance(record.msg, str) else type(record.msg).__name__
        line: dict[str, Any] = {
            "ts": _dt.datetime.fromtimestamp(record.created, _dt.UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "msg": scrub(template),
            "correlation_id": _correlation_id.get() or "-",
            "service": self.service,
            "logger": record.name,
        }
        line.update(sanitize_fields(getattr(record, "fields", None)))
        if record.exc_info:
            line.update(_exception_fields(record.exc_info))
        return json.dumps(line, ensure_ascii=False, default=str)


def configure(service: str, level: int | str = logging.INFO, stream: Any = None) -> None:
    """Route every logger in the process through the redacting JSON formatter.

    Idempotent: Lambda reuses the process across invocations and calls this on each
    cold start; the AWS Lambda runtime also pre-installs a handler that we replace.
    """
    global _service_name
    _service_name = service
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(JsonFormatter(service))
    root.addHandler(handler)
    root.setLevel(level)
    # Libraries that log request/response details at DEBUG stay quiet even if the
    # service runs at DEBUG.
    for noisy in ("botocore", "boto3", "urllib3", "psycopg", "s3transfer"):
        logging.getLogger(noisy).setLevel(max(logging.INFO, root.level))


class _FieldsAdapter(logging.LoggerAdapter):
    """Logger whose calls accept allowlisted fields as keyword arguments.

    ``log.info("kpis served", persona="msl", count=3)``
    """

    def process(self, msg: Any, kwargs: Any) -> tuple[Any, Any]:
        reserved = {"exc_info", "stack_info", "stacklevel", "extra"}
        fields = {k: kwargs.pop(k) for k in list(kwargs) if k not in reserved}
        extra = dict(kwargs.pop("extra", None) or {})
        merged = dict(extra.get("fields") or {})
        merged.update(fields)
        extra["fields"] = merged
        kwargs["extra"] = extra
        return msg, kwargs


def get_logger(name: str) -> _FieldsAdapter:
    return _FieldsAdapter(logging.getLogger(name), {})
