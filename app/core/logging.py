"""Structured logging with correlation IDs.

Provides:
* ``configure_logging()`` — human readable logs in dev, JSON lines in prod
* ``correlation_id`` context variable propagated to every log record
* ``get_logger(name)`` — thin wrapper

Log records emitted anywhere in the app automatically carry ``correlation_id``,
``actor`` (when known) and the logger name.
"""

from __future__ import annotations

import contextvars
import json
import logging
import sys
import time
import uuid
from typing import Any, Dict, Optional

from app.core.config import get_settings

# --------------------------------------------------------------------------- #
# Context
# --------------------------------------------------------------------------- #
correlation_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("correlation_id", default="-")
user_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("user", default=None)


def new_correlation_id() -> str:
    """Generate a fresh correlation id."""
    return uuid.uuid4().hex[:16]


def set_correlation_id(value: Optional[str] = None) -> str:
    """Bind a correlation id to the current context and return it."""
    cid = value or new_correlation_id()
    correlation_id_var.set(cid)
    return cid


def get_correlation_id() -> str:
    return correlation_id_var.get()


def set_request_actor(username: Optional[str] = None) -> None:
    """Attach request-scoped actor information to every subsequent log line."""
    if username:
        user_var.set(username)


# --------------------------------------------------------------------------- #
# Formatters
# --------------------------------------------------------------------------- #
class ContextFilter(logging.Filter):
    """Inject context vars into every record."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003 - stdlib signature
        record.correlation_id = correlation_id_var.get()
        record.actor = user_var.get()
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line — ready for ELK / Loki / CloudWatch."""

    _EXTRA_KEYS = ("correlation_id", "actor", "path", "method", "status_code", "duration_ms", "event")

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003
        payload: Dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in self._EXTRA_KEYS:
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class HumanFormatter(logging.Formatter):
    """Readable console format used in dev/test."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003
        base = f"{self.formatTime(record, '%H:%M:%S')} [{record.levelname:<7}] {record.name}: {record.getMessage()}"
        cid = getattr(record, "correlation_id", "-")
        if cid and cid != "-":
            base = f"{base} (cid={cid})"
        if record.exc_info:
            base = f"{base}\n{self.formatException(record.exc_info)}"
        return base


_CONFIGURED = False


def configure_logging(force: bool = False) -> None:
    """Configure root logging (idempotent)."""
    global _CONFIGURED
    if _CONFIGURED and not force:
        return

    settings = get_settings()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.LOG_JSON else HumanFormatter())
    handler.addFilter(ContextFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.LOG_LEVEL)

    # Tame noisy libraries
    for noisy in ("uvicorn.access", "sqlalchemy.engine", "watchfiles", "python_multipart"):
        logging.getLogger(noisy).setLevel(max(logging.WARNING, root.level))
    logging.getLogger("uvicorn.error").setLevel(settings.LOG_LEVEL)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Return a module logger (call :func:`configure_logging` once at startup)."""
    configure_logging()
    return logging.getLogger(name)


def log_event(logger: logging.Logger, event: str, **fields: Any) -> None:
    """Emit a structured business event (always JSON-friendly)."""
    logger.info(event, extra={"event": event, **fields})
