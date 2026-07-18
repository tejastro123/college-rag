/**
 * useAdminWS — reconnecting WebSocket hook for the admin real-time dashboard.
 *
 * Emits structured events:
 *   snapshot        → live KPI counters
 *   audit:tail      → initial audit log entries (last 20)
 *   audit:entry     → single new audit log row
 *   ingestion:update → doc processing status change
 *   alert:triggered → threshold alert
 *   users:updated   → bulk user action completed
 *   pong            → keepalive response
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { useAuthStore } from '../store'

const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8001'
const RECONNECT_DELAY_MS = 3000
const PING_INTERVAL_MS = 25000
const MAX_AUDIT_ENTRIES = 100

export function useAdminWS() {
  const { token } = useAuthStore()
  const ws = useRef(null)
  const pingTimer = useRef(null)
  const reconnectTimer = useRef(null)
  const mountedRef = useRef(true)

  const [connected, setConnected] = useState(false)
  const [snapshot, setSnapshot] = useState(null)          // KPI counters
  const [auditLog, setAuditLog] = useState([])            // live audit stream
  const [ingestionFeed, setIngestionFeed] = useState([])  // doc status updates
  const [alerts, setAlerts] = useState([])                // active alerts
  const [lastEvent, setLastEvent] = useState(null)        // raw last event

  const handlers = useRef({})

  /** Register an event handler (overrides previous for same event). */
  const on = useCallback((event, fn) => {
    handlers.current[event] = fn
  }, [])

  const send = useCallback((msg) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
  }, [])

  const requestRefresh = useCallback(() => send('refresh:stats'), [send])

  const dismissAlert = useCallback((type) => {
    setAlerts(prev => prev.filter(a => a.type !== type))
  }, [])

  const connect = useCallback(() => {
    if (!token || !mountedRef.current) return

    try {
      const url = `${WS_BASE}/api/v1/admin/ws/events?token=${encodeURIComponent(token)}`
      const socket = new WebSocket(url)
      ws.current = socket

      socket.onopen = () => {
        if (!mountedRef.current) { socket.close(); return }
        setConnected(true)
        // Start keepalive pings
        pingTimer.current = setInterval(() => send('ping'), PING_INTERVAL_MS)
      }

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          const { event, data } = msg
          setLastEvent(msg)

          // Call custom handler if registered
          handlers.current[event]?.(data)

          switch (event) {
            case 'snapshot':
              setSnapshot(data)
              break

            case 'audit:tail':
              setAuditLog(data.entries || [])
              break

            case 'audit:entry':
              setAuditLog(prev => {
                const next = [...prev, data]
                return next.length > MAX_AUDIT_ENTRIES ? next.slice(-MAX_AUDIT_ENTRIES) : next
              })
              break

            case 'ingestion:update':
              setIngestionFeed(prev => {
                const next = [data, ...prev]
                return next.length > 50 ? next.slice(0, 50) : next
              })
              // Refresh stats after ingestion completes
              if (data.status === 'indexed' || data.status === 'failed') {
                setTimeout(() => send('refresh:stats'), 500)
              }
              break

            case 'alert:triggered':
              setAlerts(prev => {
                const exists = prev.find(a => a.type === data.type)
                if (exists) return prev.map(a => a.type === data.type ? { ...a, ...data } : a)
                return [...prev, { ...data, id: Date.now() }]
              })
              break

            case 'users:updated':
              send('refresh:stats')
              break

            default:
              break
          }
        } catch {
          // non-JSON keepalive or malformed message — ignore
        }
      }

      socket.onclose = () => {
        clearInterval(pingTimer.current)
        setConnected(false)
        if (mountedRef.current) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }

      socket.onerror = () => {
        socket.close()
      }
    } catch {
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
    }
  }, [token, send])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      clearInterval(pingTimer.current)
      clearTimeout(reconnectTimer.current)
      ws.current?.close()
    }
  }, [connect])

  return {
    connected,
    snapshot,
    auditLog,
    ingestionFeed,
    alerts,
    lastEvent,
    on,
    send,
    requestRefresh,
    dismissAlert,
  }
}
