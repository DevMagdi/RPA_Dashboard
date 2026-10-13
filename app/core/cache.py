"""Small caching layer (Redis when available, in-process fallback otherwise).

Used for expensive read paths (dashboard aggregates, capacity analytics) and by
the rate limiter.  The fallback keeps the platform fully functional on a single
VM without Redis — a common on-prem bank constraint — while automatically taking
advantage of Redis in clustered deployments.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, Optional, Tuple

from app.core.config import get_settings

logger = logging.getLogger(__name__)

try:  # pragma: no cover - optional dependency at import time
    import redis as redis_sync

    _REDIS_AVAILABLE = True
except Exception:  # pragma: no cover
    redis_sync = None  # type: ignore[assignment]
    _REDIS_AVAILABLE = False


class _MemoryCache:
    """Thread-safe-ish in-process TTL cache."""

    def __init__(self) -> None:
        self._store: Dict[str, Tuple[float, str]] = {}

    def get(self, key: str) -> Optional[str]:
        entry = self._store.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if expires_at and expires_at < time.time():
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: str, ttl: int) -> None:
        self._store[key] = (time.time() + ttl if ttl else 0, value)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def delete_prefix(self, prefix: str) -> None:
        for key in [k for k in self._store if k.startswith(prefix)]:
            self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()


class CacheService:
    """Unified cache facade with graceful degradation."""

    def __init__(self) -> None:
        self._memory = _MemoryCache()
        self._client = None
        self._redis_ok = False
        self._connect()

    def _connect(self) -> None:
        if not _REDIS_AVAILABLE:
            return
        try:
            client = redis_sync.from_url(get_settings().REDIS_URL, decode_responses=True, socket_timeout=1.5)
            client.ping()
            self._client = client
            self._redis_ok = True
            logger.info("Cache: Redis backend connected")
        except Exception as exc:
            self._client = None
            self._redis_ok = False
            logger.info("Cache: Redis unavailable (%s) — using in-process cache", str(exc)[:120])

    @property
    def backend(self) -> str:
        """Which backend is currently serving reads."""
        return "redis" if self._redis_ok else "memory"

    def get_json(self, key: str) -> Optional[Any]:
        """Read and deserialise a cached value."""
        raw = None
        if self._redis_ok:
            try:
                raw = self._client.get(key)  # type: ignore[union-attr]
            except Exception:  # pragma: no cover - transient redis issue
                self._redis_ok = False
        if raw is None:
            raw = self._memory.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return None

    def set_json(self, key: str, value: Any, ttl: int = 30) -> None:
        """Serialise and cache a value."""
        try:
            raw = json.dumps(value, default=str)
        except (TypeError, ValueError):
            return
        if self._redis_ok:
            try:
                self._client.setex(key, ttl, raw)  # type: ignore[union-attr]
            except Exception:  # pragma: no cover
                self._redis_ok = False
        self._memory.set(key, raw, ttl)

    def delete(self, key: str) -> None:
        """Invalidate one key."""
        if self._redis_ok:
            try:
                self._client.delete(key)  # type: ignore[union-attr]
            except Exception:  # pragma: no cover
                pass
        self._memory.delete(key)

    def delete_prefix(self, prefix: str) -> None:
        """Invalidate every key starting with ``prefix`` (namespace busting)."""
        if self._redis_ok:
            try:
                for key in self._client.scan_iter(match=f"{prefix}*", count=200):  # type: ignore[union-attr]
                    self._client.delete(key)  # type: ignore[union-attr]
            except Exception:  # pragma: no cover
                pass
        self._memory.delete_prefix(prefix)

    def incr_with_ttl(self, key: str, ttl: int) -> int:
        """Atomic counter with TTL — the rate limiter's primitive."""
        if self._redis_ok:
            try:
                pipe = self._client.pipeline()  # type: ignore[union-attr]
                pipe.incr(key)
                pipe.expire(key, ttl)
                value, _ = pipe.execute()
                return int(value)
            except Exception:  # pragma: no cover
                self._redis_ok = False
        current = self._memory.get(key)
        count = int(current or 0) + 1
        self._memory.set(key, str(count), ttl)
        return count

    def health(self) -> Dict[str, Any]:
        """Health descriptor for ``/health/detail``."""
        info: Dict[str, Any] = {"backend": self.backend, "ok": True}
        if self._redis_ok:
            try:
                latency_start = time.perf_counter()
                self._client.ping()  # type: ignore[union-attr]
                info["latency_ms"] = round((time.perf_counter() - latency_start) * 1000, 2)
            except Exception as exc:  # pragma: no cover
                info.update(ok=False, error=str(exc)[:150])
        return info

    def publish(self, channel: str, message: Dict[str, Any]) -> None:
        """Publish a realtime event (no-op when Redis is absent)."""
        if not self._redis_ok:
            return
        try:
            self._client.publish(channel, json.dumps(message, default=str))  # type: ignore[union-attr]
        except Exception:  # pragma: no cover
            pass

    def raw_client(self):
        """Return the live Redis client (or ``None``) for pub/sub consumers.

        The realtime hub uses this to run a subscriber bridge in a background
        thread so events published by *other* workers reach this worker's SSE
        clients.  Returning the client keeps the hub free of connection logic.
        """
        return self._client if self._redis_ok else None


_cache: Optional[CacheService] = None


def get_cache() -> CacheService:
    """Return the process-wide cache facade."""
    global _cache
    if _cache is None:
        _cache = CacheService()
    return _cache


def reset_cache() -> None:
    """Reset the facade (tests / config reload)."""
    global _cache
    _cache = None
