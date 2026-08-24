/**
 * WHISPER wire protocol — the single source of truth for client ⇄ server
 * messages. The server (server/src/whisper) implements exactly this contract.
 *
 * PRIVACY: `room` snapshots are personalized per connection and never carry
 * whisper text, other players' secrets/roles/votes. Whisper content arrives
 * ONLY via `whisper_in`, addressed to one connection (or flagged `stolen` for
 * the Whisperer).
 */

/* ------------------------------------------------------------------ */
/* Client → Server                                                     */
/* ------------------------------------------------------------------ */

export type ClientMessage =
  | { t: 'tv_create'; settings?: Partial<RoomSettings> }
  | { t: 'player_join'; code?: string; name?: string; token?: string }
  | { t: 'start'; settings?: Partial<RoomSettings> }
  | { t: 'advance' }
  | { t: 'play_again' }
  | { t: 'end' }
  | { t: 'whisper_begin'; toId: string }
  | { t: 'whisper_chunk'; text: string }
  | { t: 'whisper_end' }
  | { t: 'whisper_cancel' }
  | { t: 'forge'; toId: string; text: string }
  | { t: 'vote'; targetId: string | null }
  | { t: 'ping'; ts: number }

export interface RoomSettings {
  rounds: number // 2..4
  roundSeconds: number // 45|60|75|90
  voteSeconds: number // 25|40|60
}

/* ------------------------------------------------------------------ */
/* Server → Client                                                     */
/* ------------------------------------------------------------------ */

export type ServerMessage =
  | WelcomeMsg
  | RoomMsg<TvView>
  | RoomMsg<PlayerView>
  | WhisperInMsg
  | EventMsg
  | ErrorMsg
  | PongMsg

export interface WelcomeMsg {
  t: 'welcome'
  kind: 'tv' | 'player'
  you: { id: string; name: string }
  token?: string
  code: string
}

export interface RoomMsg<V> {
  t: 'room'
  view: V
}

export interface PublicPlayer {
  id: string
  name: string
  connected: boolean
}

export interface Outcome {
  verdict: 'silence' | 'hollow'
  banishedId: string | null
  banishedName: string | null
  wasTie: boolean
}

export interface PublicStats {
  whispersDelivered: number
  dread: number
  votesCast: number
}

/** Snapshot for the shared screen / TV. Public information only. */
export interface TvView {
  code: string
  phase: Phase
  phaseEndsAt: number | null
  round: number
  rounds: number
  now: number
  settings: RoomSettings
  players: PublicPlayer[]
  feed: { line: string; at: number }[]
  omenLine: string
  publicStats: PublicStats
  outcome: Outcome | null
  reveal: { id: string; name: string; role: Role }[] | null
  epilogues:
    | { name: string; role: Role; objectiveDone: boolean | null }[]
    | null
}

export type ObjectiveKind = 'bait' | 'listeners' | 'silence' | 'whisperer'

export interface Objective {
  kind: ObjectiveKind
  label: string
  text: string
  hint: string
  payload: { word?: string; count?: number; round?: number }
  done: boolean
}

/** Personalized snapshot for ONE player's phone. */
export interface PlayerView {
  code: string
  phase: Phase
  phaseEndsAt: number | null
  round: number
  rounds: number
  now: number
  roundSeconds: number
  voteSeconds: number
  players: PublicPlayer[]
  me: {
    id: string
    name: string
    role: Role | null
    secret: string
    baitWord: string
    objective: Objective | null
    unread: number
    heardFromCount: number
    sentThisRound: boolean
    whisperingTo: string | null
    myVote: string | null
    voteSealed: boolean
    forgeUsed: boolean
    epilogue: string | null
  }
  publicStats: PublicStats
  outcome: Outcome | null
}

export type Phase =
  | 'lobby'
  | 'intro'
  | 'secrets'
  | 'whisper'
  | 'omen'
  | 'vote'
  | 'ending'

export type Role = 'innocent' | 'whisperer'

/** Delivered whisper content — routed to exactly one phone (+ stolen copies). */
export interface WhisperInMsg {
  t: 'whisper_in'
  message: {
    id: string
    fromName: string
    text: string
    at: number
    /** True on copies intercepted by the Whisperer. */
    stolen: boolean
  }
}

export type GameEvent =
  | { t: 'event'; kind: 'game_start' }
  | { t: 'event'; kind: 'round_start'; round: number }
  | { t: 'event'; kind: 'omen'; line: string }
  | { t: 'event'; kind: 'vote_open' }
  | { t: 'event'; kind: 'ending'; verdict: 'silence' | 'hollow' }
  | { t: 'event'; kind: 'back_to_lobby' }
  | { t: 'event'; kind: 'room_closed' }
  | { t: 'event'; kind: 'tv_lost' }
  | { t: 'event'; kind: 'room_replaced' }
  | { t: 'event'; kind: 'room_expired' }

export type EventMsg = GameEvent

export interface ErrorMsg {
  t: 'error'
  code: string
  message: string
}

export interface PongMsg {
  t: 'pong'
  ts: number
  now: number
}

/* ------------------------------------------------------------------ */
/* Connection helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Resolve the game server's WebSocket endpoint.
 * NEXT_PUBLIC_SERVER_URL wins when set (e.g. dev: http://localhost:8787);
 * otherwise same-origin — production serves the app and socket together.
 */
export function resolveSocketUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SERVER_URL ?? '').trim().replace(/\/+$/, '')
  let origin = raw
  if (!origin && typeof window !== 'undefined') origin = window.location.origin
  if (!origin) return '/whisper'
  return `${origin.replace(/^http/, 'ws')}/whisper`
}
