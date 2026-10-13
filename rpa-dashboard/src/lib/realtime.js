/**
 * Realtime transport.
 *
 * The API exposes Server-Sent Events (`/api/realtime/events`) plus a
 * WebSocket fallback (`/ws/realtime`).  SSE is preferred because corporate
 * proxies handle it well and it reconnects automatically — but this module
 * degrades gracefully: if the stream cannot be established (or the tab was
 * hidden for a long time), consumers fall back to polling, so the dashboard
 * never shows stale numbers silently.
 */

const listeners = new Set()
const stateListeners = new Set()

const STATE = { CONNECTING: 'connecting', OPEN: 'open', CLOSED: 'closed' }

const realtime = {
  source: null,
  status: STATE.CLOSED,
  lastEventAt: null,
  retries: 0,
  stopped: true,
  timer: null,
}

function emitState() {
  const payload = {
    status: realtime.status,
    lastEventAt: realtime.lastEventAt,
    retries: realtime.retries,
  }
  stateListeners.forEach((listener) => listener(payload))
}

function setStatus(status) {
  if (realtime.status === status) return
  realtime.status = status
  emitState()
}

function dispatch(event, data) {
  realtime.lastEventAt = Date.now()
  listeners.forEach((listener) => {
    try {
      listener(event, data)
    } catch (error) {
      // A misbehaving consumer must not kill the stream
      console.error('realtime listener failed', error)
    }
  })
}

function scheduleReconnect() {
  if (realtime.stopped) return
  realtime.retries += 1
  // 1s, 2s, 4s … capped at 30s with jitter so a restarting cluster does not
  // synchronise all clients onto the same retry instant.
  const delay = Math.min(30000, 1000 * 2 ** Math.min(realtime.retries, 5)) + Math.random() * 500
  clearTimeout(realtime.timer)
  realtime.timer = setTimeout(() => open(), delay)
  emitState()
}

function open() {
  if (realtime.stopped || realtime.source) return
  if (typeof EventSource === 'undefined') return

  setStatus(STATE.CONNECTING)
  const source = new EventSource('/api/realtime/events', { withCredentials: true })
  realtime.source = source

  source.onopen = () => {
    realtime.retries = 0
    setStatus(STATE.OPEN)
    dispatch('__status', { status: STATE.OPEN })
  }

  const forwarded = [
    'connected',
    'kpi_update',
    'dashboard_update',
    'agent_heartbeat',
    'command_ack',
    'run_started',
    'run_completed',
    'capacity_update',
    'recommendation_updated',
  ]
  forwarded.forEach((name) => {
    source.addEventListener(name, (event) => {
      let payload = null
      try {
        payload = JSON.parse(event.data)
      } catch {
        payload = event.data
      }
      dispatch(name, payload)
    })
  })

  source.onerror = () => {
    source.close()
    realtime.source = null
    if (realtime.stopped) return
    setStatus(STATE.CLOSED)
    scheduleReconnect()
  }
}

/** Start streaming (idempotent). */
export function startRealtime() {
  realtime.stopped = false
  open()
}

/** Stop streaming (called on sign-out). */
export function stopRealtime() {
  realtime.stopped = true
  clearTimeout(realtime.timer)
  if (realtime.source) {
    realtime.source.close()
    realtime.source = null
  }
  setStatus(STATE.CLOSED)
}

export function realtimeStatus() {
  return {
    status: realtime.status,
    lastEventAt: realtime.lastEventAt,
    retries: realtime.retries,
  }
}

/** Subscribe to a specific realtime event. Returns an unsubscribe function. */
export function onRealtime(event, handler) {
  const listener = (name, payload) => {
    if (name === event || event === '*') handler(payload, name)
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function onRealtimeState(handler) {
  stateListeners.add(handler)
  handler(realtimeStatus())
  return () => stateListeners.delete(handler)
}

export { STATE as REALTIME_STATE }
export default realtime
