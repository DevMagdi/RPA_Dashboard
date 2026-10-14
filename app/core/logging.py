"""Structured logging with correlation IDs.

Provides:
* ``configure_logging()`` — human readable logs in dev, JSON lines in prod
* ``correlation_id`` context variable propagated to every log record
* ``get_logger(name)`` — thin wrapper

Encoding: every handler is forced to **UTF-8** with ``errors="backslashreplace"``.
A Windows Service runs with a legacy console code page (cp1256/cp437), and a
handler bound to that stream silently replaces Arabic with ``?`` — the ``????``
defect operators saw in the service log.  ``configure_stream_encoding()`` also
reconfigures ``stdout``/``stderr`` themselves so prints made by third-party
libraries cannot corrupt Arabic either.

Log records emitted anywhere in the app automatically carry ``correlation_id``,
``actor`` (when known) and the logger name.
"""

from __future__ import annotations

import contextvars
import io
import json
import logging
import os
import sys
import time
import uuid
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, Optional, TextIO

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


def configure_stream_encoding(stream: Optional[TextIO] = None) -> Optional[TextIO]:
    r"""Force UTF-8 (with escapes as a safety net) on a text stream.

    Returns the stream to use.  ``errors="backslashreplace"`` is deliberate: if
    a glyph cannot be encoded we keep ``\uXXXX`` in the log line instead of
    losing the character to ``?`` — an operator reading an audit trail must be
    able to see which Arabic value was rejected.
    """
    if stream is None:
        return None
    encoding = (getattr(stream, "encoding", "") or "").lower().replace("-", "")
    if encoding in ("utf8", "utf8mb4", "cp65001"):
        return stream

    reconfigure = getattr(stream, "reconfigure", None)
    if callable(reconfigure):
        try:
            reconfigure(encoding="utf-8", errors="backslashreplace")
            return stream
        except (ValueError, OSError, io.UnsupportedOperation):  # pragma: no cover - platform specific
            pass

    try:  # pragma: no cover - only reachable on a legacy console
        return open(  # noqa: SIM115 - wrapper around an existing descriptor
            stream.fileno(),
            "w",
            encoding="utf-8",
            errors="backslashreplace",
            buffering=1,
            closefd=False,
        )
    except (OSError, ValueError, AttributeError, io.UnsupportedOperation):
        return stream


def configure_process_encoding() -> None:
    """Make the whole process UTF-8-safe (Windows Services, cron, containers)."""
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")
    sys.stdout = configure_stream_encoding(sys.stdout)
    sys.stderr = configure_stream_encoding(sys.stderr)


def configure_logging(force: bool = False) -> None:
    """Configure root logging (idempotent)."""
    global _CONFIGURED
    if _CONFIGURED and not force:
        return

    settings = get_settings()
    configure_process_encoding()

    handler = logging.StreamHandler(configure_stream_encoding(sys.stdout) or sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.LOG_JSON else HumanFormatter())
    handler.addFilter(ContextFilter())

    root = logging.getLogger()
    handlers: list[logging.Handler] = [handler]

    log_file = (getattr(settings, "LOG_FILE", "") or "").strip()
    if log_file:
        try:
            file_handler = RotatingFileHandler(
                log_file,
                maxBytes=10 * 1024 * 1024,
                backupCount=5,
                encoding="utf-8",
                errors="backslashreplace",
                delay=True,
            )
            file_handler.setFormatter(JsonFormatter() if settings.LOG_JSON else HumanFormatter())
            file_handler.addFilter(ContextFilter())
            handlers.append(file_handler)
        except OSError:  # pragma: no cover - unwritable path must not stop boot
            logging.getLogger(__name__).warning("Log file %s is not writable; console logging only", log_file)

    root.handlers = handlers
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
