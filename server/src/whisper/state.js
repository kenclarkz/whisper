/**
 * WHISPER — server-authoritative game state machine.
 *
 * Pure logic over plain room objects. No I/O, no timers, no sockets: the hub
 * (`hub.js`) drives this module and owns connections/timers. Everything that
 * touches secrets, roles, whispers or votes happens HERE so privacy rules are
 * enforced in exactly one place. Views returned to clients are built by
 * `playerView()` / `tvView()` which strip every field a client must never see
 * (other players' roles, secrets, inbox contents, …).
 */

import {
  LIMITS,
  CODE_ALPHABET,
  BAIT_WORDS,
  SECRETS,
  OBJECTIVES,
  OMENS,
} from './content.js'

export const FIXED_DURATIONS = {
  intro: 16000,
  secrets: 18000,
  omen: 9000,
}

export const DEFAULT_SETTINGS = {
  rounds: 3,
  roundSeconds: 75,
  voteSeconds: 40,
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

let idCounter = 0
export function uid(prefix = 'p') {
  idCounter += 1
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function generateCode(existingCodes = new Set()) {
  for (let attempt = 0; attempt < 999; attempt++) {
    let code = ''
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
    if (!existingCodes.has(code)) return code
  }
  throw new Error('code_space_exhausted')
}

export function cleanText(value, maxChars) {
  if (typeof value !== 'string') return ''
  // Strip control characters; collapse whitespace (one breath per whisper).
  const stripped = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  return stripped.replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

function shuffle(list) {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function makeToken() {
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  for (let i = 0; i < bytes.length; i++) {
    if (!bytes[i]) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ------------------------------------------------------------------ */
/* Rooms & players                                                     */
/* ------------------------------------------------------------------ */

export function createRoom(code, settings = {}) {
  return {
    code,
    phase: 'lobby',
    phaseEndsAt: null,
    round: 0, // 1-based while phase === 'whisper'
    settings: { ...DEFAULT_SETTINGS, ...settings },
    dread: 0,
    createdAt: Date.now(),
    players: [],
    /** Public activity feed lines for the TV ("a whisper crossed the dark"). */
    feed: [],
    omenLine: '',
    outcome: null, // filled at ending: { verdict, banishedId, tallies, ... }
    _openWhispers: new Map(), // fromId -> { toId, parts, chars }
    _forgedThisRound: new Set(),
  }
}

export function sanitizeSettings(input = {}) {
  const s = {}
  const rounds = Number(input.rounds)
  if ([2, 3, 4].includes(rounds)) s.rounds = rounds
  const secs = Number(input.roundSeconds)
  if ([45, 60, 75, 90].includes(secs)) s.roundSeconds = secs
  const vs = Number(input.voteSeconds)
  if ([25, 40, 60].includes(vs)) s.voteSeconds = vs
  return s
}

export function addPlayer(room, rawName) {
  if (room.phase !== 'lobby') return { error: 'game_in_progress' }
  const name = cleanText(rawName, LIMITS.nameMax)
  if (name.length < LIMITS.nameMin) return { error: 'bad_name' }
  if (room.players.length >= LIMITS.maxPlayers) return { error: 'room_full' }

  const taken = new Set(room.players.map((p) => p.name.toLowerCase()))
  if (taken.has(name.toLowerCase())) return { error: 'name_taken' }

  const player = {
    id: uid('P'),
    name,
    token: makeToken(),
    connected: false,
    role: null, // 'innocent' | 'whisperer'
    secret: '',
    baitWord: '',
    objective: null, // { kind, label, text, hint, payload, done }
    inbox: [], // whispers addressed to this player (incl. stolen copies)
    unread: 0,
    sentRounds: [], // per round: did they send a whisper?
    heardFrom: [], // distinct sender ids of real deliveries
    voteId: undefined, // undefined = not sealed, null = abstained
    _lastSeen: Date.now(),
  }
  room.players.push(player)
  return { player }
}

export function reclaimPlayer(room, token) {
  if (!token) return { error: 'bad_token' }
  const player = room.players.find((p) => p.token === token)
  if (!player) return { error: 'bad_token' }
  player.connected = true
  player._lastSeen = Date.now()
  return { player }
}

export function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) ?? null
}

export function whisperersOf(room) {
  return room.players.filter((p) => p.role === 'whisperer')
}

/* ------------------------------------------------------------------ */
/* Starting & role assignment                                          */
/* ------------------------------------------------------------------ */

export function startGame(room, settingsInput = {}) {
  if (room.phase !== 'lobby') return { error: 'already_started' }
  if (room.players.length < LIMITS.minPlayers) return { error: 'need_players' }
  Object.assign(room.settings, sanitizeSettings(settingsInput))

  const order = shuffle(room.players)
  order.forEach((p, i) => {
    p.role = i === 0 ? 'whisperer' : 'innocent'
  })

  const words = shuffle(BAIT_WORDS)
  const secrets = shuffle(SECRETS)
  const kinds = shuffle(['bait', 'listeners', 'silence'])
  const listenerTarget = room.players.length <= 5 ? 2 : 3

  order.forEach((p, i) => {
    p.inbox = []
    p.unread = 0
    p.sentRounds = []
    p.heardFrom = []
    p.voteId = undefined

    if (p.role === 'whisperer') {
      p.secret =
        'You died in this house years ago. Tonight you wear a voice like a coat — and the Hollow has lent you its tongue.'
      p.baitWord = ''
      p.objective = {
        kind: 'whisperer',
        label: 'THE TONGUE',
        text: 'Remain unmasked at the final vote. Steal every whisper. Sow doubt.',
        hint: 'You hear every whisper. Once per round you may forge one.',
        payload: {},
        done: false,
      }
      return
    }

    const word = words[i % words.length]
    p.baitWord = word
    p.secret = secrets[i % secrets.length].replaceAll('%WORD%', word)

    const kind = kinds[i % kinds.length]
    let payload
    if (kind === 'bait') payload = { word }
    else if (kind === 'listeners') payload = { count: listenerTarget }
    else payload = { round: 1 + Math.floor(Math.random() * room.settings.rounds) }

    p.objective = {
      kind,
      label: OBJECTIVES[kind].label,
      text: OBJECTIVES[kind].text(payload),
      hint: OBJECTIVES[kind].hint,
      payload,
      done: false,
    }
  })

  enterPhase(room, 'intro')
  return { ok: true }
}

export function phaseDurationMs(room, phase) {
  if (phase === 'whisper') return room.settings.roundSeconds * 1000
  if (phase === 'vote') return room.settings.voteSeconds * 1000
  return FIXED_DURATIONS[phase] ?? null
}

function enterPhase(room, phase, now = Date.now()) {
  room.phase = phase
  const dur = phaseDurationMs(room, phase)
  room.phaseEndsAt = dur ? now + dur : null
}

/* ------------------------------------------------------------------ */
/* Phase progression                                                   */
/* ------------------------------------------------------------------ */

/**
 * Advance the state machine one step. Called by the hub when the current
 * phase deadline expires or the TV forces an advance.
 */
export function advance(room, now = Date.now()) {
  const effects = { closed: [] }

  switch (room.phase) {
    case 'intro':
      enterPhase(room, 'secrets', now)
      break
    case 'secrets':
      beginRound(room, 1, now)
      effects.event = { kind: 'round_start', round: 1 }
      break
    case 'whisper':
      effects.closed.push(...endRound(room, now))
      if (room.round >= room.settings.rounds) {
        enterPhase(room, 'vote', now)
        effects.event = { kind: 'vote_open' }
      } else {
        room.omenLine = OMENS[Math.floor(Math.random() * OMENS.length)]
        enterPhase(room, 'omen', now)
        effects.event = { kind: 'omen', line: room.omenLine }
      }
      break
    case 'omen':
      beginRound(room, room.round + 1, now)
      effects.event = { kind: 'round_start', round: room.round }
      break
    case 'vote':
      effects.verdict = finishVote(room, now)
      effects.event = { kind: 'ending', verdict: effects.verdict.verdict }
      break
    default:
      break
  }
  return effects
}

function beginRound(room, round, now = Date.now()) {
  room.round = round
  room._forgedThisRound = new Set()
  room.omenLine = ''
  enterPhase(room, 'whisper', now)
}

function endRound(room, now) {
  const closed = []
  for (const fromId of [...room._openWhispers.keys()]) {
    closed.push(closeWhisper(room, fromId, now))
  }
  // Resolve THE VOW (silence) objectives for the round that just ended.
  for (const p of room.players) {
    if (p.role !== 'innocent' || !p.objective || p.objective.kind !== 'silence') continue
    if (p.objective.payload.round === room.round) {
      p.objective.done = !p.sentRounds[room.round]
    }
  }
  return closed
}

/* ------------------------------------------------------------------ */
/* Whispering                                                          */
/* ------------------------------------------------------------------ */

export function openWhisper(room, fromId, toId) {
  const from = findPlayer(room, fromId)
  const to = findPlayer(room, toId)
  if (!from || !to) return { error: 'unknown_player' }
  if (room.phase !== 'whisper') return { error: 'not_whisper_phase' }
  if (from.id === to.id) return { error: 'cannot_whisper_self' }
  if (!from.connected || !to.connected) return { error: 'player_offline' }
  if (room._openWhispers.has(from.id)) return { error: 'already_whispering' }

  room._openWhispers.set(from.id, { toId: to.id, parts: [], chars: 0 })
  return { ok: true, toName: to.name }
}

export function chunkWhisper(room, fromId, text) {
  const open = room._openWhispers.get(fromId)
  if (!open) return { error: 'no_open_whisper' }
  const piece = cleanText(text, LIMITS.whisperMaxChars)
  if (open.chars + piece.length > LIMITS.whisperMaxChars) return { error: 'too_long' }
  if (piece) {
    open.parts.push(piece)
    open.chars += piece.length
  }
  return { ok: true, length: open.chars }
}

export function cancelWhisper(room, fromId) {
  return room._openWhispers.delete(fromId)
    ? { ok: true }
    : { error: 'no_open_whisper' }
}

/**
 * Finalize the sender's open whisper and route it.
 *
 * PRIVACY CONTRACT: content goes ONLY to the intended recipient's inbox plus
 * (flagged as STOLEN) to any Whisperer who is neither party. Nobody else —
 * and no snapshot — ever carries whisper text.
 *
 * Returns `{ ok, delivered:[{playerId,message}], to, from }` or an error.
 */
export function closeWhisper(room, fromId, now = Date.now(), cancelledText = '') {
  const open = room._openWhispers.get(fromId)
  if (!open) return { error: 'no_open_whisper' }
  room._openWhispers.delete(fromId)

  const from = findPlayer(room, fromId)
  const to = findPlayer(room, open.toId)
  if (!from || !to) return { error: 'unknown_player' }

  const text = cleanText(cancelledText || open.parts.join(' '), LIMITS.whisperMaxChars)
  if (!text) return { ok: true, delivered: [], from: from.id } // nothing said

  from.sentRounds[room.round] = true
  from._lastSeen = now

  const message = {
    id: uid('W'),
    fromId: from.id,
    fromName: from.name,
    text,
    at: now,
    stolen: false,
    forged: false,
  }

  receiveInbox(to, { ...message })
  if (!to.heardFrom.includes(from.id)) to.heardFrom.push(from.id)
  maybeCompleteBait(to, text)

  const delivered = [{ playerId: to.id, message }]

  // The Whisperer steals whispers they are not part of.
  for (const w of whisperersOf(room)) {
    if (w.id === from.id || w.id === to.id) continue
    receiveInbox(w, { ...message, stolen: true })
    delivered.push({ playerId: w.id, message: { ...message, stolen: true } })
  }

  pushFeed(room, 'A whisper crossed the dark.')
  return { ok: true, delivered, to: to.id, from: from.id }
}

function receiveInbox(player, message) {
  player.inbox.push(message)
  player.unread += 1
  if (player.inbox.length > 30) player.inbox.splice(0, player.inbox.length - 30)
}

function maybeCompleteBait(target, text) {
  const obj = target.objective
  if (!obj || obj.kind !== 'bait' || obj.done) return
  const re = new RegExp(`\\b${escapeRegExp(obj.payload.word)}\\b`, 'i')
  if (re.test(text)) obj.done = true
}

/**
 * Whisperer power: forge ONE anonymous whisper per round. The message arrives
 * on the target's phone attributed to a randomly chosen OTHER innocent, so it
 * is indistinguishable from a real whisper. Even the `forged` flag is stripped
 * before delivery — only fellow whisperers see stolen/forged metadata.
 */
export function forgeWhisper(room, whispererId, toId, text, now = Date.now()) {
  const w = findPlayer(room, whispererId)
  const to = findPlayer(room, toId)
  if (!w || w.role !== 'whisperer') return { error: 'forbidden' }
  if (room.phase !== 'whisper') return { error: 'not_whisper_phase' }
  if (!to || to.id === w.id) return { error: 'bad_target' }
  if (!to.connected) return { error: 'player_offline' }
  if (room._forgedThisRound.has(w.id)) return { error: 'forge_used' }

  const body = cleanText(text, LIMITS.whisperMaxChars)
  if (!body) return { error: 'empty' }

  // A believable false sender: another innocent, not the target.
  const candidates = room.players.filter(
    (p) => p.role === 'innocent' && p.id !== to.id
  )
  if (candidates.length === 0) return { error: 'no_disguise' }
  const disguise = candidates[Math.floor(Math.random() * candidates.length)]

  room._forgedThisRound.add(w.id)
  room.dread += 1
  w._lastSeen = now

  const message = {
    id: uid('W'),
    fromId: disguise.id,
    fromName: disguise.name,
    text: body,
    at: now,
    stolen: false,
    forged: true,
  }
  receiveInbox(to, { ...message, forged: false })
  if (!to.heardFrom.includes(disguise.id)) to.heardFrom.push(disguise.id)
  maybeCompleteBait(to, body)

  const delivered = [{ playerId: to.id, message: { ...message, forged: false } }]
  for (const other of whisperersOf(room)) {
    if (other.id === w.id) continue
    receiveInbox(other, { ...message, stolen: true })
    delivered.push({ playerId: other.id, message: { ...message, stolen: true } })
  }

  pushFeed(room, 'Something speaks with a borrowed voice.')
  return { ok: true, delivered, to: to.id }
}

export function forgeUsedBy(room, whispererId) {
  return Boolean(room._forgedThisRound.has(whispererId))
}

export function openWhisperTargetOf(room, fromId) {
  const open = room._openWhispers.get(fromId)
  return open ? open.toId : null
}

/* ------------------------------------------------------------------ */
/* Voting                                                              */
/* ------------------------------------------------------------------ */

export function castVote(room, voterId, targetId) {
  if (room.phase !== 'vote') return { error: 'not_vote_phase' }
  const voter = findPlayer(room, voterId)
  if (!voter) return { error: 'unknown_player' }
  if (targetId !== null && targetId !== undefined) {
    const target = findPlayer(room, targetId)
    if (!target) return { error: 'unknown_player' }
  }
  voter.voteId = targetId ?? null
  voter._lastSeen = Date.now()
  return { ok: true }
}

export function votesCast(room) {
  return room.players.filter((p) => p.voteId !== undefined).length
}

/**
 * Seal the vote and decide the game.
 * Strict plurality banishes; ties and mass abstention free the Whisperer.
 */
export function finishVote(room, now = Date.now()) {
  const counts = new Map()
  for (const p of room.players) {
    if (p.voteId) counts.set(p.voteId, (counts.get(p.voteId) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted[0] ?? null
  const tie = sorted.length > 1 && sorted[1][1] === top[1]
  const banished = top && !tie ? findPlayer(room, top[0]) : null
  const caught = banished?.role === 'whisperer'

  room.outcome = {
    verdict: caught ? 'silence' : 'hollow',
    banishedId: banished?.id ?? null,
    banishedName: banished?.name ?? null,
    wasTie: !banished,
    tallies: Object.fromEntries(counts),
    dread: room.dread,
  }

  for (const p of room.players) {
    if (p.role === 'whisperer') p.objective.done = !caught
  }

  enterPhase(room, 'ending')
  return room.outcome
}

/** Reset back to the lobby with the same players (Play Again). */
export function resetToLobby(room) {
  room.phase = 'lobby'
  room.phaseEndsAt = null
  room.round = 0
  room.dread = 0
  room.outcome = null
  room.feed = []
  room.omenLine = ''
  room._openWhispers.clear()
  room._forgedThisRound = new Set()
  for (const p of room.players) {
    p.role = null
    p.secret = ''
    p.baitWord = ''
    p.objective = null
    p.inbox = []
    p.unread = 0
    p.sentRounds = []
    p.heardFrom = []
    p.voteId = undefined
  }
}

/* ------------------------------------------------------------------ */
/* Feed & epilogues                                                    */
/* ------------------------------------------------------------------ */

export function pushFeed(room, line) {
  room.feed.push({ line, at: Date.now() })
  if (room.feed.length > 12) room.feed.splice(0, room.feed.length - 12)
}

export function epilogueFor(player, outcome) {
  if (player.role === 'whisperer') {
    return outcome.verdict === 'silence'
      ? 'They pulled your mask of skin away. The moths remember your name.'
      : 'You walked out with their voices folded in your pocket.'
  }
  if (player.objective?.done) {
    return 'Your memory stayed yours. Whatever wears this house, it could not take that.'
  }
  return 'You left the table lighter than you came. Something of yours remained behind.'
}

/* ------------------------------------------------------------------ */
/* Client views (privacy firewall)                                     */
/* ------------------------------------------------------------------ */

function publicPlayer(p) {
  return { id: p.id, name: p.name, connected: p.connected }
}

/**
 * Personalized snapshot for one connection. Whisper TEXT never appears here —
 * only inbox metadata counts. Content is delivered exclusively through
 * `whisper_in` messages routed by closeWhisper/forgeWhisper.
 */
export function playerView(room, player, now = Date.now()) {
  return {
    code: room.code,
    phase: room.phase,
    phaseEndsAt: room.phaseEndsAt,
    round: room.round,
    rounds: room.settings.rounds,
    now,
    roundSeconds: room.settings.roundSeconds,
    voteSeconds: room.settings.voteSeconds,
    players: room.players.map(publicPlayer),
    me: {
      id: player.id,
      name: player.name,
      role: player.role,
      secret: player.secret,
      baitWord: player.baitWord,
      objective: player.objective
        ? {
            kind: player.objective.kind,
            label: player.objective.label,
            text: player.objective.text,
            hint: player.objective.hint,
            payload: player.objective.payload,
            done: player.objective.done,
          }
        : null,
      unread: player.unread,
      heardFromCount: player.heardFrom.length,
      sentThisRound: Boolean(player.sentRounds[room.round]),
      whisperingTo: openWhisperTargetOf(room, player.id),
      myVote: player.voteId === undefined ? null : player.voteId,
      voteSealed: player.voteId !== undefined,
      forgeUsed: player.role === 'whisperer' ? forgeUsedBy(room, player.id) : false,
      epilogue:
        room.phase === 'ending' && room.outcome
          ? epilogueFor(player, room.outcome)
          : null,
    },
    publicStats: {
      whispersDelivered: countDelivered(room),
      dread: room.dread,
      votesCast: votesCast(room),
    },
    outcome:
      room.phase === 'ending' && room.outcome
        ? {
            verdict: room.outcome.verdict,
            banishedId: room.outcome.banishedId,
            banishedName: room.outcome.banishedName,
            wasTie: room.outcome.wasTie,
          }
        : null,
  }
}

/** Snapshot for the shared screen. Public information only. */
export function tvView(room, now = Date.now()) {
  const outcome = room.outcome
  return {
    code: room.code,
    phase: room.phase,
    phaseEndsAt: room.phaseEndsAt,
    round: room.round,
    rounds: room.settings.rounds,
    now,
    settings: room.settings,
    players: room.players.map(publicPlayer),
    feed: room.feed.slice(-6),
    omenLine: room.phase === 'omen' ? room.omenLine : '',
    publicStats: {
      whispersDelivered: countDelivered(room),
      dread: room.dread,
      votesCast: votesCast(room),
    },
    outcome:
      room.phase === 'ending' && outcome
        ? {
            verdict: outcome.verdict,
            banishedId: outcome.banishedId,
            banishedName: outcome.banishedName,
            wasTie: outcome.wasTie,
          }
        : null,
    /** Reveal roles only at the very end. */
    reveal:
      room.phase === 'ending'
        ? room.players.map((p) => ({ id: p.id, name: p.name, role: p.role }))
        : null,
    epilogues:
      room.phase === 'ending'
        ? room.players.map((p) => ({
            name: p.name,
            role: p.role,
            objectiveDone: p.role === 'innocent' ? Boolean(p.objective?.done) : null,
          }))
        : null,
  }
}

function countDelivered(room) {
  return room.players.reduce(
    (n, p) => n + p.inbox.filter((m) => !m.stolen).length,
    0
  )
}
