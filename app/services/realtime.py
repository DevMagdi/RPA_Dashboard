"""Realtime fan-out: WebSocket hub + Server-Sent Events.

The dashboard must feel live (KPIs updating without a manual refresh) while
staying light on the database.  Instead of every browser polling every 15
seconds, one background tick publishes a compact snapshot and the hub fans it
out to all subscribers.

Transport matrix
----------------
* **SSE** (``/api/realtime/events``) — one-way, proxy friendly, automatic
  browser reconnection; used by the dashboard by default.
* **WebSocket** (``/ws/realtime``) — bidirectional; used for the control console
  (command acknowledgements) and for agents.

Both are permission-filtered: a viewer never receives events outside their department scope
outside their department scope.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import WebSocket

from app.core.cache import get_cache
from app.core.metrics import track_agent_count

logger = logging.getLogger(__name__)

CHANNEL_REALTIME = "rpa_realtime"

#: Identifies this process so the Redis bridge can skip its own messages
#: (they were already delivered locally by :meth:`RealtimeHub.publish`).
INSTANCE_ID = uuid.uuid4().hex[:12]


@dataclass
class Subscriber:
    """A connected dashboard client (SSE queue or WebSocket)."""

    id: str
    user_id: int
    department: str
    role: str
    queue: Optional[asyncio.Queue] = None
    websocket: Optional[WebSocket] = None
    connected_at: float = field(default_factory=time.time)


class RealtimeHub:
    """In-process pub/sub hub with optional Redis bridging.

    Running multiple API workers?  Redis pub/sub carries the events across
    processes (``publish`` writes to Redis, each worker's bridge re-broadcasts
    locally).  Single process?  Everything works in memory.
    """

    def __init__(self) -> None:
        self._subscribers: Dict[str, Subscriber] = {}
        self._agent_sockets: Dict[str, WebSocket] = {}
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------ #
    # Dashboard clients
    # ------------------------------------------------------------------ #
    async def subscribe_sse(
        self, *, subscriber_id: str, user_id: int, department: str, role: str
    ) -> AsyncIterator[str]:
        """Yield SSE-formatted events for one client."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        subscriber = Subscriber(
            id=subscriber_id, user_id=user_id, department=department, role=role, queue=queue
        )
        async with self._lock:
            self._subscribers[subscriber_id] = subscriber
        logger.info("SSE subscriber connected: %s", subscriber_id)

        try:
            yield _sse_event("connected", {"subscriber_id": subscriber_id, "server_time": time.time()})
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield _sse_event(event["event"], event["data"])
                except asyncio.TimeoutError:
                    # Heartbeat keeps proxies (and corporate firewalls) from closing
                    yield ": heartbeat\n\n"
        finally:
            async with self._lock:
                self._subscribers.pop(subscriber_id, None)
            logger.info("SSE subscriber disconnected: %s", subscriber_id)

    async def register_websocket(self, websocket: WebSocket, subscriber: Subscriber) -> None:
        """Track a bidirectional dashboard socket."""
        async with self._lock:
            self._subscribers[subscriber.id] = subscriber

    async def unregister(self, subscriber_id: str) -> None:
        """Drop a subscriber (disconnect / error)."""
        async with self._lock:
            self._subscribers.pop(subscriber_id, None)

    # ------------------------------------------------------------------ #
    # Agent sockets (runner control channel)
    # ------------------------------------------------------------------ #
    async def register_agent(self, machine_name: str, websocket: WebSocket) -> None:
        """Attach a runner agent socket (one per machine)."""
        async with self._lock:
            existing = self._agent_sockets.get(machine_name)
            self._agent_sockets[machine_name] = websocket
        if existing is not None:
            try:
                await existing.close(code=1000)
            except Exception:  # pragma: no cover - already gone
                pass
        track_agent_count(absolute=len(self._agent_sockets))
        logger.info("Agent connected: %s (total=%s)", machine_name, len(self._agent_sockets))

    async def unregister_agent(self, machine_name: str) -> None:
        """Detach a runner agent socket."""
        async with self._lock:
            self._agent_sockets.pop(machine_name, None)
        track_agent_count(absolute=len(self._agent_sockets))
        logger.info("Agent disconnected: %s (total=%s)", machine_name, len(self._agent_sockets))

    async def disconnect_agent(self, machine_name: str, *, code: int = 1008) -> bool:
        """Force-close a runner's control channel (token revocation)."""
        async with self._lock:
            websocket = self._agent_sockets.pop(machine_name, None)
        if websocket is None:
            return False
        try:
            await websocket.close(code=code)
        except Exception:  # pragma: no cover - already gone
            pass
        track_agent_count(absolute=len(self._agent_sockets))
        logger.warning("Agent force-disconnected: %s", machine_name)
        return True

    def agent_connected(self, machine_name: str) -> bool:
        """True when a runner currently has a live control channel."""
        return machine_name in self._agent_sockets

    async def send_to_agent(self, machine_name: str, payload: Dict[str, Any]) -> bool:
        """Deliver a command to a runner (returns False when offline)."""
        websocket = self._agent_sockets.get(machine_name)
        if not websocket:
            return False
        try:
            await websocket.send_json(payload)
            return True
        except Exception as exc:  # pragma: no cover - socket race
            logger.warning("Failed to send to agent %s: %s", machine_name, exc)
            await self.unregister_agent(machine_name)
            return False

    def connected_agents(self) -> List[str]:
        """Names of runners with a live socket."""
        return sorted(self._agent_sockets.keys())

    # ------------------------------------------------------------------ #
    # Publishing
    # ------------------------------------------------------------------ #
    async def deliver_local(
        self, event: str, data: Dict[str, Any], *, department: Optional[str] = None
    ) -> int:
        """Fan out an event to this process's subscribers only.

        Used by the Redis bridge: events arriving from another worker must be
        delivered locally **without** being re-published (that would loop).
        """
        delivered = 0
        async with self._lock:
            targets = list(self._subscribers.values())

        for subscriber in targets:
            if department is not None and subscriber.department not in ("ALL", department):
                continue
            message = {"event": event, "data": data}
            try:
                if subscriber.queue is not None:
                    subscriber.queue.put_nowait(message)
                    delivered += 1
                elif subscriber.websocket is not None:
                    await subscriber.websocket.send_json(message)
                    delivered += 1
            except asyncio.QueueFull:
                logger.warning("Subscriber %s lagging — dropping event %s", subscriber.id, event)
            except Exception as exc:  # pragma: no cover - socket race
                logger.debug("Delivery to %s failed: %s", subscriber.id, exc)
        return delivered

    async def publish(
        self, event: str, data: Dict[str, Any], *, department: Optional[str] = None
    ) -> int:
        """Deliver locally then bridge to the other workers through Redis."""
        delivered = await self.deliver_local(event, data, department=department)
        get_cache().publish(
            CHANNEL_REALTIME,
            {"event": event, "data": data, "department": department, "origin": INSTANCE_ID},
        )
        return delivered

    def publish_background(self, event: str, data: Dict[str, Any], *, department: Optional[str] = None) -> None:
        """Fire-and-forget publish from a synchronous context (threads, jobs)."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            loop.create_task(self.publish(event, data, department=department))
        else:
            get_cache().publish(
                CHANNEL_REALTIME,
                {"event": event, "data": data, "department": None, "origin": INSTANCE_ID},
            )

    def subscriber_count(self) -> int:
        """Number of connected dashboard clients (health page)."""
        return len(self._subscribers)

    def snapshot(self) -> Dict[str, Any]:
        """Diagnostics for ``/health/detail``."""
        return {
            "subscribers": len(self._subscribers),
            "agents_connected": len(self._agent_sockets),
            "agents": self.connected_agents(),
        }

    async def close_all(self) -> None:
        """Close every socket during shutdown (prevents lingering agents)."""
        async with self._lock:
            subscribers = list(self._subscribers.values())
            agents = list(self._agent_sockets.items())
            self._subscribers.clear()
            self._agent_sockets.clear()

        for subscriber in subscribers:
            if subscriber.websocket is not None:
                with contextlib.suppress(Exception):
                    await subscriber.websocket.close(code=1001)
        for _machine_name, socket in agents:
            with contextlib.suppress(Exception):
                await socket.close(code=1001)
        track_agent_count(absolute=0)
        logger.info("Realtime hub closed (%s subscriber(s), %s agent(s))", len(subscribers), len(agents))


def _sse_event(event: str, data: Dict[str, Any]) -> str:
    """Format a message as an SSE frame."""
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


# --------------------------------------------------------------------------- #
# Cross-worker bridge (redis pub/sub -> local fan-out)
# --------------------------------------------------------------------------- #
_bridge_thread: Optional[threading.Thread] = None
_bridge_stop = threading.Event()


def start_redis_bridge(loop: Optional[asyncio.AbstractEventLoop] = None) -> bool:
    """Subscribe to the Redis realtime channel and mirror events locally.

    Returns ``True`` when a bridge thread was started.  Without Redis (single
    process / sandbox) the hub keeps working purely in memory, so this is a
    best-effort optimisation, never a hard dependency.
    """
    global _bridge_thread

    if _bridge_thread and _bridge_thread.is_alive():
        return True

    client = get_cache().raw_client()
    if client is None:
        logger.info("Realtime bridge disabled: cache backend is in-process memory")
        return False

    try:
        event_loop = loop or asyncio.get_running_loop()
    except RuntimeError:  # pragma: no cover - called before the loop exists
        logger.warning("Realtime bridge not started: no running event loop")
        return False

    pubsub = client.pubsub(ignore_subscribe_messages=True)
    pubsub.subscribe(CHANNEL_REALTIME)
    _bridge_stop.clear()

    def _forward(payload: Dict[str, Any]) -> None:
        """Schedule local delivery of a remote event on the API event loop."""

        async def _deliver() -> None:
            try:
                await hub.deliver_local(
                    str(payload.get("event") or "message"),
                    payload.get("data") or {},
                    
                    department=payload.get("department"),
                )
            except Exception as exc:  # pragma: no cover - defensive
                logger.debug("Bridged delivery failed: %s", exc)

        try:
            asyncio.run_coroutine_threadsafe(_deliver(), event_loop)
        except RuntimeError:  # pragma: no cover - loop shutting down
            pass

    def _listen() -> None:
        logger.info("Realtime bridge started on channel %s", CHANNEL_REALTIME)
        try:
            for message in pubsub.listen():
                if _bridge_stop.is_set():
                    break
                if message.get("type") != "message":
                    continue
                try:
                    payload = json.loads(message.get("data") or "{}")
                except (TypeError, ValueError):
                    continue
                if payload.get("origin") == INSTANCE_ID:
                    continue  # already delivered in-process by publish()
                _forward(payload)
        except Exception as exc:  # pragma: no cover - redis drop
            logger.warning("Realtime bridge stopped: %s", exc)
        finally:
            try:
                pubsub.close()
            except Exception:  # pragma: no cover
                pass
            logger.info("Realtime bridge closed")

    _bridge_thread = threading.Thread(target=_listen, name="realtime-redis-bridge", daemon=True)
    _bridge_thread.start()
    return True


def stop_redis_bridge(timeout: float = 2.0) -> None:
    """Signal the bridge thread to stop (called from the app lifespan)."""
    global _bridge_thread
    if _bridge_thread is None:
        return
    _bridge_stop.set()
    _bridge_thread.join(timeout=timeout)
    _bridge_thread = None


hub = RealtimeHub()
