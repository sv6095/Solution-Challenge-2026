/**
 * use-websocket.ts — Real-Time WebSocket Event Hook
 * ===================================================
 * Establishes a persistent WebSocket connection to the backend
 * event bus. Provides typed event dispatch for React components.
 *
 * Usage:
 *   const { lastEvent, isConnected, sendMessage } = useWebSocket();
 *
 * Events received:
 *   - incident_created / incident_updated / incident_resolved
 *   - reasoning_step
 *   - checkpoint_raised
 *   - threshold_tuned
 *   - signal_detected
 *   - rfq_sent
 *   - heartbeat / pong
 */
import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WSEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

type WSEventHandler = (event: WSEvent) => void;

// ── Module-level singleton ───────────────────────────────────────────────────

let _ws: WebSocket | null = null;
const _listeners: Set<WSEventHandler> = new Set();
let _tenantId: string | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 30_000;
const CLIENT_PING_INTERVAL_MS = 20_000;

function _getWsUrl(tenantId: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const apiBase = import.meta.env.VITE_API_BASE
    ?? import.meta.env.VITE_API_URL
    ?? import.meta.env.VITE_API_BASE_URL
    ?? "";
  const host = apiBase.replace(/^https?:\/\//, "") || window.location.host;
  // Strip trailing /api if present, then any trailing slash
  const cleanHost = host.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  return `${proto}//${cleanHost}/ws/${tenantId}`;
}

function _connect(tenantId: string) {
  if (_ws?.readyState === WebSocket.OPEN || _ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  _tenantId = tenantId;
  const url = _getWsUrl(tenantId);

  try {
    _ws = new WebSocket(url);
  } catch {
    _scheduleReconnect(tenantId);
    return;
  }

  _ws.onopen = () => {
    _reconnectAttempt = 0;
    // Dispatch connected event
    const evt: WSEvent = {
      type: "ws_connected",
      payload: { tenantId },
      timestamp: new Date().toISOString(),
    };
    _listeners.forEach((fn) => fn(evt));
  };

  _ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as WSEvent;
      _listeners.forEach((fn) => fn(event));
    } catch {
      // Ignore malformed messages
    }
  };

  _ws.onclose = () => {
    _ws = null;
    const evt: WSEvent = {
      type: "ws_disconnected",
      payload: { tenantId },
      timestamp: new Date().toISOString(),
    };
    _listeners.forEach((fn) => fn(evt));
    _scheduleReconnect(tenantId);
  };

  _ws.onerror = () => {
    // Will trigger onclose
  };
}

function _scheduleReconnect(tenantId: string) {
  if (_listeners.size === 0) return;
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  const baseDelay = Math.min(1000 * Math.pow(2, _reconnectAttempt), MAX_RECONNECT_DELAY);
  const jitter = Math.floor(Math.random() * 400);
  const delay = baseDelay + jitter;
  _reconnectAttempt++;
  _reconnectTimer = setTimeout(() => _connect(tenantId), delay);
}

function _disconnect() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_ws) {
    _ws.onclose = null; // Prevent reconnect on intentional close
    _ws.close();
    _ws = null;
  }
}

function _sendPing() {
  if (_ws?.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: "ping" }));
  }
}

// ── React Hook ───────────────────────────────────────────────────────────────

export function useWebSocket(tenantId?: string | null) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);
  const handlerRef = useRef<WSEventHandler | null>(null);

  useEffect(() => {
    if (!tenantId?.trim()) return;

    const handler: WSEventHandler = (event) => {
      setLastEvent(event);
      if (event.type === "ws_connected") setIsConnected(true);
      if (event.type === "ws_disconnected") setIsConnected(false);
    };

    handlerRef.current = handler;
    _listeners.add(handler);

    // Connect if not already connected (or if tenant changed)
    if (_tenantId !== tenantId || !_ws) {
      _disconnect();
      _connect(tenantId);
    }

    // Keepalive ping every 30s
    const pingInterval = setInterval(_sendPing, CLIENT_PING_INTERVAL_MS);

    return () => {
      _listeners.delete(handler);
      clearInterval(pingInterval);
      // Only disconnect if no more listeners
      if (_listeners.size === 0) {
        _disconnect();
      }
    };
  }, [tenantId]);

  const sendMessage = useCallback((msg: Record<string, unknown>) => {
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify(msg));
    }
  }, []);

  return { lastEvent, isConnected, sendMessage };
}

// ── Typed event subscription hook ────────────────────────────────────────────

export function useWSEvent(
  tenantId: string | null | undefined,
  eventType: string,
  onEvent: (payload: Record<string, unknown>) => void,
) {
  const { lastEvent, isConnected } = useWebSocket(tenantId);

  useEffect(() => {
    if (lastEvent?.type === eventType) {
      onEvent(lastEvent.payload);
    }
  }, [lastEvent, eventType, onEvent]);

  return { isConnected };
}

// ── Convenience: auto-invalidate React Query on push ─────────────────────────

export function useWSQueryInvalidation(
  tenantId: string | null | undefined,
  queryClient: { invalidateQueries: (opts: { queryKey: string[] }) => void },
) {
  const { lastEvent, isConnected } = useWebSocket(tenantId);
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!lastEvent) return;

    // Map WS event types to React Query cache keys for automatic invalidation
    const invalidationMap: Record<string, string[][]> = {
      incident_created: [
        ["incidents"],
        ["intelligence", "simulation-incidents"],
        ["dashboard", "kpis"],
        ["command"],
        ["risks", "events"],
        ["incident-summary-nav"]
      ],
      incident_updated: [
        ["incidents"],
        ["intelligence", "simulation-incidents"],
        ["dashboard", "kpis"],
        ["command"],
        ["risks", "events"],
        ["incident-summary-nav"]
      ],
      incident_resolved: [
        ["incidents"],
        ["intelligence", "simulation-incidents"],
        ["dashboard", "kpis"],
        ["command"],
        ["risks", "events"],
        ["incident-summary-nav"]
      ],
      reasoning_step: [["reasoning"]],
      checkpoint_raised: [
        ["governance", "checkpoints"],
        ["governance-checkpoints-nav"]
      ],
      threshold_tuned: [["governance", "thresholds"]],
      signal_detected: [
        ["signals"],
        ["signals", "categorized"],
        ["dashboard", "events"],
        ["risks", "events"],
        ["g"]
      ],
      rfq_sent: [["rfq"]],
      worldmonitor_updated_batch: [
        ["globalDashboardBundle"],
        ["g"],
        ["marketImplications"],
        ["marketQuotes"],
        ["macro"],
        ["energy"],
        ["supplyChainNews"],
        ["conflict"],
        ["minerals"],
        ["risks", "events"],
        ["risks", "suppliers"],
        ["command"]
      ]
    };

    const keys = invalidationMap[lastEvent.type];
    if (keys) {
      keys.forEach((queryKey) => {
        pendingKeysRef.current.add(JSON.stringify(queryKey));
      });

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        pendingKeysRef.current.forEach((serializedKey) => {
          try {
            const queryKey = JSON.parse(serializedKey);
            queryClient.invalidateQueries({ queryKey });
          } catch (e) {
            console.error(e);
          }
        });
        pendingKeysRef.current.clear();
        debounceRef.current = null;
      }, 1000);
    }
  }, [lastEvent, queryClient]);

  return { isConnected };
}
