# ADR-003: SSE for realtime, with a `?token=` authentication fallback

- **Status:** Accepted (3.0.0)
- **Date:** 2026-10-13

## Context
The dashboard needs live KPI updates. WebSockets work, but Server-Sent Events
survive corporate proxies better, reconnect automatically, and need no client
library. However, the browser `EventSource` API **cannot set headers**, so a
Bearer-only SSE endpoint is unusable from the SPA.

## Decision
Use SSE at `GET /api/realtime/events`. Authenticate with the `Authorization`
header when present, otherwise accept the short-lived access token as a
`?token=` query parameter (`current_principal_sse` in `app/api/deps.py`),
validated through the exact same code path. A bidirectional WebSocket remains
available for the control console and the agent channel (`/ws/agent/...`).
nginx is configured with `proxy_buffering off` for the SSE location.

## Consequences
- Tokens in URLs can appear in proxy logs; mitigated by the 15-minute access
  token lifetime and by preferring the header wherever the client supports it.
- Heartbeats every 25 s keep intermediaries from closing idle streams.
