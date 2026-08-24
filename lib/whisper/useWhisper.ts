'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useWhisperSocket,
  useSender,
  type ConnState,
} from './client'
import {
  resolveSocketUrl,
  type PlayerView,
  type ServerMessage,
  type TvView,
  type WelcomeMsg,
  type WhisperInMsg,
  type RoomSettings,
} from './protocol'
import { loadSession, saveSession, clearSession, type WhisperSession } from './session'

export interface ToastError {
  code: string
  message: string
}

/**
 * One WHISPER connection per page — TV or phone.
 *
 * The hook owns the socket lifecycle, session persistence (token-based seat
 * reclaim), the latest personalized snapshot and the phone's private inbox.
 */
export function useWhisperGame() {
  const url = resolveSocketUrl()
  // Auto-connect on mount: pages gate their UI on connState === 'open',
  // and actions like tv_create/join queue behind the opening handshake.
  const { socketRef, connState, generation } = useWhisperSocket(url)
  const send = useSender(socketRef)

  const [welcome, setWelcome] = useState<WelcomeMsg | null>(null)
  const [tvView, setTvView] = useState<TvView | null>(null)
  const [playerView, setPlayerView] = useState<PlayerView | null>(null)
  const [inbox, setInbox] = useState<WhisperInMsg['message'][]>([])
  const [error, setError] = useState<ToastError | null>(null)
  const [lastEvent, setLastEvent] = useState<
    Extract<ServerMessage, { t: 'event' }> | null
  >(null)
  const [closedReason, setClosedReason] = useState<string | null>(null)
  const sessionRef = useRef<WhisperSession | null>(null)

  /* ---------------- inbound message routing ---------------- */

  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return
    const off = socket.onAny((msg) => {
      switch (msg.t) {
        case 'welcome': {
          setWelcome(msg)
          setClosedReason(null)
          if (msg.kind === 'player') {
            sessionRef.current = {
              kind: 'player',
              code: msg.code,
              name: msg.you.name,
              playerId: msg.you.id,
              token: msg.token,
            }
            saveSession(sessionRef.current)
          } else {
            sessionRef.current = { kind: 'tv', code: msg.code, name: 'TV' }
            saveSession(sessionRef.current)
          }
          break
        }
        case 'room':
          if ('me' in msg.view) {
            setTvView(null)
            setPlayerView(msg.view)
          } else {
            setPlayerView(null)
            setTvView(msg.view)
          }
          break
        case 'whisper_in':
          setInbox((prev) => [...prev.slice(-40), msg.message])
          break
        case 'event':
          setLastEvent(msg)
          if (
            msg.kind === 'room_closed' ||
            msg.kind === 'tv_lost' ||
            msg.kind === 'room_expired' ||
            msg.kind === 'room_replaced'
          ) {
            setClosedReason(msg.kind === 'room_replaced' ? 'replaced' : msg.kind)
            clearSession()
            sessionRef.current = null
          }
          break
        case 'error':
          // Transient toasts; join errors surface through the same channel.
          setError({ code: msg.code, message: msg.message })
          break
        default:
          break
      }
    })
    return off
  }, [socketRef, generation])

  /** Auto-reclaim the saved seat whenever the socket (re)opens. */
  useEffect(() => {
    if (connState !== 'open') return
    if (!sessionRef.current && welcome === null) {
      const saved = loadSession()
      if (saved) sessionRef.current = saved
    }
    const s = sessionRef.current
    if (s?.kind === 'player' && s.token) {
      send({ t: 'player_join', token: s.token })
    } else if (s?.kind === 'tv') {
      send({ t: 'ping', ts: Date.now() }) // keep-alive probe; TV re-creates manually
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connState])

  /* ---------------- actions ---------------- */

  const createRoom = useCallback(
    (settings?: Partial<RoomSettings>) => {
      clearSession()
      sessionRef.current = null
      socketRef.current?.connect()
      socketRef.current?.send({ t: 'tv_create', settings })
    },
    [socketRef]
  )

  const join = useCallback(
    (code: string, name: string) => {
      clearSession()
      sessionRef.current = null
      setError(null)
      socketRef.current?.connect()
      // Queue order matters: connect() then join — the client queues until open.
      socketRef.current?.send({ t: 'player_join', code: code.toUpperCase(), name })
    },
    [socketRef]
  )

  const startGame = useCallback(
    (settings?: Partial<RoomSettings>) => send({ t: 'start', settings }),
    [send]
  )
  const advance = useCallback(() => send({ t: 'advance' }), [send])
  const playAgain = useCallback(() => {
    setInbox([])
    send({ t: 'play_again' })
  }, [send])
  const endGame = useCallback(() => send({ t: 'end' }), [send])

  const beginWhisper = useCallback(
    (toId: string) => {
      send({ t: 'whisper_begin', toId })
    },
    [send]
  )
  const pushChunk = useCallback((text: string) => send({ t: 'whisper_chunk', text }), [send])
  const endWhisper = useCallback(() => send({ t: 'whisper_end' }), [send])
  const cancelWhisper = useCallback(() => send({ t: 'whisper_cancel' }), [send])
  const forge = useCallback(
    (toId: string, text: string) => send({ t: 'forge', toId, text }),
    [send]
  )
  const castVote = useCallback(
    (targetId: string | null) => send({ t: 'vote', targetId }),
    [send]
  )

  const markInboxRead = useCallback(() => {
    setPlayerView((v) =>
      v ? { ...v, me: { ...v.me, unread: 0 } } : v
    )
  }, [])

  const leave = useCallback(() => {
    clearSession()
    sessionRef.current = null
    socketRef.current?.close()
  }, [socketRef])

  return {
    connState: connState as ConnState,
    welcome,
    view: tvView ?? playerView,
    tvView,
    playerView,
    inbox,
    error,
    dismissError: () => setError(null),
    lastEvent,
    closedReason,
    actions: {
      createRoom,
      join,
      startGame,
      advance,
      playAgain,
      endGame,
      beginWhisper,
      pushChunk,
      endWhisper,
      cancelWhisper,
      forge,
      castVote,
      markInboxRead,
      leave,
    },
  }
}

export type WhisperGame = ReturnType<typeof useWhisperGame>
