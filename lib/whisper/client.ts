'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import type { ClientMessage, ServerMessage } from './protocol'

type Listener = (msg: ServerMessage) => void
export type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

/**
 * A small reconnecting WebSocket wrapper around the WHISPER protocol.
 *
 * - `onAny` subscribes to every server message (components filter by `t`).
 * - `send` is safe before the socket opens (queued until open).
 * - Auto-reconnects with capped backoff while `shouldStayOpen`.
 */
export class WhisperSocket {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private stateListeners = new Set<(s: ConnState) => void>()
  private queue: ClientMessage[] = []
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldStayOpen = false
  readonly url: string
  state: ConnState = 'idle'
  /** Bumped on every successful (re)connect — useful as a re-sync signal. */
  generation = 0

  constructor(url: string) {
    this.url = url
  }

  onAny(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onState(listener: (s: ConnState) => void): () => void {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => this.stateListeners.delete(listener)
  }

  private setState(s: ConnState) {
    this.state = s
    for (const l of this.stateListeners) l(s)
  }

  connect() {
    if (this.shouldStayOpen) return // already running
    this.shouldStayOpen = true
    this.open()
  }

  private open() {
    this.setState('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.attempts = 0
      this.generation += 1
      this.setState('open')
      const pending = this.queue.splice(0)
      for (const msg of pending) this.send(msg)
    }

    ws.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      for (const l of [...this.listeners]) {
        try {
          l(msg)
        } catch (err) {
          console.error('[whisper] listener failed', err)
        }
      }
    }

    ws.onclose = (ev) => {
      this.ws = null
      if (!this.shouldStayOpen || ev.code === 4000 || ev.code === 4001) {
        // Server closed the room or superseded us — do not loop.
        this.shouldStayOpen = false
        this.setState('closed')
        return
      }
      this.setState('error')
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      /* close handler drives recovery */
    }
  }

  private scheduleReconnect() {
    if (!this.shouldStayOpen || this.reconnectTimer) return
    const delay = Math.min(8000, 600 * Math.pow(2, this.attempts++))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      this.queue.push(msg)
    }
  }

  ping() {
    this.send({ t: 'ping', ts: Date.now() })
  }

  close() {
    this.shouldStayOpen = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* noop */
      }
      this.ws = null
    }
    this.setState('closed')
  }
}

/**
 * React binding: one stable WhisperSocket per hook consumer, torn down on
 * unmount. Returns the socket plus the latest connection state.
 */
export function useWhisperSocket(
  url: string,
  autoConnect = true
): { socketRef: MutableRefObject<WhisperSocket | null>; connState: ConnState; generation: number } {
  const socketRef = useRef<WhisperSocket | null>(null)
  const [connState, setConnState] = useState<ConnState>('idle')
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const socket = new WhisperSocket(url)
    socketRef.current = socket
    const offState = socket.onState(setConnState)

    const checkGen = setInterval(() => {
      setGeneration((g) => (g === socket.generation ? g : socket.generation))
    }, 400)

    if (autoConnect) socket.connect()

    return () => {
      clearInterval(checkGen)
      offState()
      socket.close()
      socketRef.current = null
    }
  }, [url, autoConnect])

  return { socketRef, connState, generation }
}

/** Convenience: stable callback that sends via the current socket. */
export function useSender(socketRef: MutableRefObject<WhisperSocket | null>) {
  return useCallback(
    (msg: ClientMessage) => socketRef.current?.send(msg),
    [socketRef]
  )
}
