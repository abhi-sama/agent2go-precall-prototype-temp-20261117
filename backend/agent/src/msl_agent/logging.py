"""Minimal structured logging that deliberately admits only safe fields."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

SAFE_FIELDS = frozenset({"correlation_id", "thread_id", "event_count", "record_count", "mode"})


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "msg": record.getMessage(),
            "service": "msl-agent",
        }
        for field in SAFE_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        return json.dumps(payload, separators=(",", ":"), default=str)


def configure_logging() -> logging.Logger:
    logger = logging.getLogger("msl_agent")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
    return logger


logger = configure_logging()


def audit(event: str, *, correlation_id: str, **context: Any) -> None:
    """Log operational metadata only; arbitrary values are discarded by the formatter."""
    safe_context = {key: value for key, value in context.items() if key in SAFE_FIELDS}
    logger.info(event, extra={"correlation_id": correlation_id, **safe_context})
