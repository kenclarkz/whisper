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
  /* mansion board mode */
  | { t: 'roll' }
  | { t: 'mg_input'; data: MgInputData }
  | { t: 'item_use'; itemId: string; targetId?: string }
  | { t: 'haunt'; targetId?: string }
  | { t: 'ping'; ts: number }

/** Union of every minigame input the server understands. */
export type MgInputData =
  | { type: 'tap' }
  | { type: 'run_on' }
  | { type: 'run_off' }
  | { type: 'vote'; targetId: string }
  | { type: 'move'; dir: 'up' | 'down' | 'left' | 'right' }

export interface RoomSettings {
  mode: 'mansion' | 'ritual'
  laps: number // mansion: board laps per player (2..4) → turns = laps × players
  rounds: number // ritual: whisper rounds (2..4)
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
  mode: GameMode
  settings: RoomSettings
  players: PublicPlayer[]
  feed: { line: string; at: number }[]
  omenLine: string
  match: MatchView | null
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
  mode: GameMode
  players: PublicPlayer[]
  match: MatchView | null
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
    matchPriv: MatchPrivate | null
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
  /* mansion board mode */
  | 'board_intro'
  | 'board'
  | 'minigame_intro'
  | 'minigame'
  | 'minigame_results'
  | 'results'

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
  | { t: 'event'; kind: 'game_start'; mode?: GameMode }
  | { t: 'event'; kind: 'round_start'; round: number }
  | { t: 'event'; kind: 'omen'; line: string }
  | { t: 'event'; kind: 'vote_open' }
  | { t: 'event'; kind: 'ending'; verdict: 'silence' | 'hollow' }
  | { t: 'event'; kind: 'back_to_lobby' }
  | { t: 'event'; kind: 'room_closed' }
  | { t: 'event'; kind: 'tv_lost' }
  | { t: 'event'; kind: 'room_replaced' }
  | { t: 'event'; kind: 'room_expired' }
  /* mansion board mode */
  | { t: 'event'; kind: 'match_start' }
  | { t: 'event'; kind: 'turn_start'; playerId: string }
  | { t: 'event'; kind: 'roll_result'; playerId: string; value: number; effective: number }
  | { t: 'event'; kind: 'step'; playerId: string; pos: number }
  | { t: 'event'; kind: 'space_result'; playerId: string; pos: number; type: string; text: string }
  | { t: 'event'; kind: 'soul_gain'; playerId: string; amount: number }
  | { t: 'event'; kind: 'item_found'; playerId: string; itemId: string }
  | { t: 'event'; kind: 'item_used'; playerId: string; itemId: string; targetId: string | null }
  | { t: 'event'; kind: 'cursed'; playerId: string; curse: string }
  | { t: 'event'; kind: 'curses_cleared'; playerId: string }
  | { t: 'event'; kind: 'mystery'; playerId: string; id: string; text: string }
  | { t: 'event'; kind: 'horror'; id: string; text: string; stage: number }
  | { t: 'event'; kind: 'contest'; rolls: { id: string; r: number }[] }
  | { t: 'event'; kind: 'harm'; playerId: string; amount: number }
  | { t: 'event'; kind: 'ward_block'; playerId: string }
  | { t: 'event'; kind: 'swap'; a: string; b: string }
  | { t: 'event'; kind: 'shortcut'; playerId: string }
  | { t: 'event'; kind: 'player_dead'; playerId: string }
  | { t: 'event'; kind: 'revived'; playerId: string }
  | { t: 'event'; kind: 'haunt_offer'; playerId: string; targets: string[] }
  | { t: 'event'; kind: 'haunt_steal'; ghostId: string; targetId: string }
  | { t: 'event'; kind: 'haunt_spook'; ghostId: string; targetId: string }
  | { t: 'event'; kind: 'stage_change'; stage: number; name: string }
  | { t: 'event'; kind: 'minigame_soon' }
  | { t: 'event'; kind: 'minigame_start'; id: string; name: string; tagline: string }
  | { t: 'event'; kind: 'minigame_end'; id: string; scores: { playerId: string; score: number }[] }
  | { t: 'event'; kind: 'mg_sync' }
  | { t: 'event'; kind: 'winner'; playerIds: string[] }

export type EventMsg = GameEvent

export type GameMode = 'mansion' | 'ritual'

/* ------------------------------------------------------------------ */
/* Mansion board views                                                 */
/* ------------------------------------------------------------------ */

export type PlayerStatus = 'alive' | 'ghost'
export type SpaceType =
  | 'start'
  | 'soul'
  | 'item'
  | 'mystery'
  | 'curse'
  | 'horror'
  | 'shortcut'
  | 'safe'

export interface MatchPlayer {
  id: string
  name: string
  connected: boolean
  pos: number
  souls: number
  status: PlayerStatus
  itemCount: number
  curses: string[]
  isTurn: boolean
}

export interface MgPublic {
  id: string
  name: string
  tagline: string
  controlsHint?: string
  durationMs?: number
  endsAt?: number | null
  publicState?: Record<string, unknown>
  results?: MgResultRow[]
}

export interface MgResultRow {
  playerId: string
  score: number
  note: string
  soulsDelta: number
}

/** Public board state — identical for TV and every phone. */
export interface MatchView {
  order: string[]
  currentPlayerId: string | null
  turnCount: number
  totalTurns: number
  stage: number
  stageName: string
  awaiting: 'roll' | 'move' | 'haunt' | null
  turnDeadline: number | null
  players: MatchPlayer[]
  lastRoll: { playerId: string; value: number; effective: number } | null
  lastSpace: { pos: number; type: SpaceType; name: string } | null
  log: { line: string; at: number }[]
  mg: MgPublic | null
  results: {
    rows: { playerId: string; souls: number; status: PlayerStatus }[]
    winnerIds: string[]
  } | null
  now: number
}

export interface MatchPrivate {
  pos: number
  souls: number
  status: PlayerStatus
  items: string[]
  curses: string[]
  isMyTurn: boolean
  awaitingMe: 'roll' | 'move' | 'haunt' | null
  privateMg?: Record<string, unknown>
  rank?: number
  won?: boolean
  epilogue?: string
}

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
