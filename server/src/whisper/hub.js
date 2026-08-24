/**
 * WHISPER — WebSocket hub.
 *
 * Owns connections, rooms lifecycle and the phase ticker; delegates ALL game
 * rules to `state.js`. Every mutation funnels through here so the privacy
 * contract holds in one place:
 *
 *   - Each connection receives ITS OWN personalized snapshot (`room`).
 *   - Whisper content travels only via `whisper_in`, addressed to a single
 *     connection (recipient) or to Whisperer connections flagged `stolen`.
 *   - Snapshots never contain whisper text, other players' secrets, roles
 *     (until the ending reveal) or votes.
 */

import {
  createRoom,
  generateCode,
  sanitizeSettings,
  addPlayer,
  reclaimPlayer,
  findPlayer,
  startGame,
  advance,
  openWhisper,
  chunkWhisper,
  cancelWhisper,
  closeWhisper,
  forgeWhisper,
  castVote,
  resetToLobby,
  cleanText,
  tvView,
  playerView,
} from './state.js'
import {
  rollDice as rollDiceEngine,
  mgInput as mgInputEngine,
  useItem as useItemEngine,
  haunt as hauntEngine,
  mansionTick as mansionTickEngine,
  drainEvents,
} from '../mansion/engine.js'
import { LIMITS } from './content.js'
import { config } from '../config.js'
import logger from '../utils/logger.js'

const TICK_MS = 500
const HEARTBEAT_MS = 15000

export function attachWhisperHub({ wss }) {
  /** code -> room */
  const rooms = new Map()
  /** WebSocket -> conn record */
  const conns = new Map()

  /* ---------------------------------------------------------------- */

  function codes() {
    return new Set(rooms.keys())
  }

  function send(ws, payload) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(payload))
      } catch (err) {
        logger.warn('ws send failed:', err?.message ?? err)
      }
    }
  }

  function connOf(ws) {
    return conns.get(ws)
  }

  function roomOf(conn) {
    return conn.roomCode ? rooms.get(conn.roomCode) ?? null : null
  }

  function emitEvent(room, event) {
    if (!event) return
    const payload = { t: 'event', ...event }
    for (const conn of conns.values()) {
      if (conn.roomCode === room.code) send(conn.ws, payload)
    }
  }

  /**
   * Push every connection in the room its own filtered snapshot. This is the
   * ONLY way snapshots leave the server.
   */
  function syncRoom(room) {
    const now = Date.now()
    for (const conn of conns.values()) {
      if (conn.roomCode !== room.code || conn.kind === null) continue
      if (conn.kind === 'tv') {
        send(conn.ws, { t: 'room', view: tvView(room, now) })
      } else {
        const me = findPlayer(room, conn.playerId)
        if (me) send(conn.ws, { t: 'room', view: playerView(room, me, now) })
      }
    }
  }

  /** Deliver routed whisper copies produced by state.closeWhisper/forgeWhisper. */
  function deliver(room, result) {
    for (const d of result.delivered ?? []) {
      for (const conn of conns.values()) {
        if (conn.roomCode === room.code && conn.playerId === d.playerId) {
          send(conn.ws, {
            t: 'whisper_in',
            message: {
              id: d.message.id,
              fromName: d.message.fromName,
              text: d.message.text,
              at: d.message.at,
              stolen: Boolean(d.message.stolen),
            },
          })
        }
      }
    }
  }

  function destroyRoom(room, reason = 'room_closed') {
    emitEvent(room, { kind: reason })
    for (const [ws, conn] of conns.entries()) {
      if (conn.roomCode === room.code) {
        conn.kind = null
        conn.playerId = null
        conn.roomCode = null
        try {
          ws.close(4000, reason)
        } catch {
          /* already closing */
        }
      }
    }
    rooms.delete(room.code)
    logger.info(`room ${room.code} destroyed (${reason})`)
  }

  /* ---------------------------------------------------------------- */
  /* Phase ticker & heartbeats                                         */
  /* ---------------------------------------------------------------- */

  const ticker = setInterval(() => {
    const now = Date.now()
    for (const room of [...rooms.values()]) {
      // TV vanished — give the party a grace window before tearing down.
      const hasTv = [...conns.values()].some(
        (c) => c.roomCode === room.code && c.kind === 'tv' && c.alive
      )
      if (!hasTv) {
        room._tvLostAt ??= now
        if (now - room._tvLostAt > config.tvGraceMs) {
          destroyRoom(room, 'tv_lost')
          continue
        }
      } else {
        room._tvLostAt = null
      }

      if (room.settings.mode === 'mansion' && room.match) {
        // The board engine owns its own phase deadlines and turn loop.
        const events = mansionTickEngine(room, now)
        for (const ev of events) emitEvent(room, { ...ev })
        if (events.length) syncRoomThrottled(room, now)
        continue
      }

      if (
        room.phaseEndsAt &&
        now >= room.phaseEndsAt &&
        ['intro', 'secrets', 'whisper', 'omen', 'vote'].includes(room.phase)
      ) {
        doAdvance(room, now)
        continue
      }

      // Safety valve: abandoned lobby rooms eventually die.
      if (room.phase === 'lobby' && now - room.createdAt > 2 * 60 * 60 * 1000) {
        destroyRoom(room, 'room_expired')
      }
    }
  }, TICK_MS)

  /** Minigame simulation changes state every tick — cap snapshot spam. */
  const lastMansionSync = new Map() // code -> ts
  function syncRoomThrottled(room, now) {
    const last = lastMansionSync.get(room.code) ?? 0
    if (now - last < 450) return
    lastMansionSync.set(room.code, now)
    syncRoom(room)
  }

  const heartbeat = setInterval(() => {
    for (const [ws, conn] of conns.entries()) {
      if (!conn.alive) {
        try {
          ws.terminate()
        } catch {
          /* noop */
        }
        continue
      }
      conn.alive = false
      try {
        ws.ping()
      } catch {
        /* noop */
      }
    }
  }, HEARTBEAT_MS)

  function doAdvance(room, now = Date.now()) {
    const effects = advance(room, now)
    for (const closed of effects.closed) {
      if (closed.ok) deliver(room, closed)
    }
    emitEvent(room, effects.event)
    for (const ev of effects.mansionEvents ?? []) emitEvent(room, { ...ev })
    syncRoom(room)
  }

  /* ---------------------------------------------------------------- */
  /* Message dispatch                                                  */
  /* ---------------------------------------------------------------- */

  function error_(ws, code, message) {
    send(ws, { t: 'error', code, message })
  }

  const handlers = {
    tv_create(ws, conn, msg) {
      if (conn.kind === 'tv' && conn.roomCode && rooms.has(conn.roomCode)) {
        destroyRoom(rooms.get(conn.roomCode), 'room_replaced')
      }
      let code
      try {
        code = generateCode(codes())
      } catch {
        return error_(ws, 'code_exhausted', 'Could not allocate a room code.')
      }
      const room = createRoom(code, sanitizeSettings(msg.settings))
      rooms.set(code, room)
      conn.kind = 'tv'
      conn.roomCode = code
      conn.playerId = null
      logger.info(`room ${code} created`)
      send(ws, { t: 'welcome', kind: 'tv', you: { id: 'tv', name: 'TV' }, code })
      syncRoom(room)
    },

    player_join(ws, conn, msg) {
      const code = String(msg.code ?? '').trim().toUpperCase()
      const room = rooms.get(code)
      if (!room) return error_(ws, 'unknown_room', 'No séance with that code.')

      let result
      let player
      if (msg.token) {
        result = reclaimPlayer(room, cleanText(msg.token, 64))
        player = result.player
        if (!player) return error_(ws, 'bad_token', 'This phone lost its seal. Join again.')
      } else {
        result = addPlayer(room, msg.name)
        if (result.error) {
          const messages = {
            game_in_progress: 'The ritual has begun.',
            bad_name: 'The house needs a real name.',
            room_full: 'The table seats eight.',
            name_taken: 'That name already answers.',
          }
          return error_(ws, result.error, messages[result.error] ?? 'Cannot join.')
        }
        player = result.player
        player.connected = true
      }

      // Supersede any older socket still holding this identity.
      for (const [otherWs, other] of conns.entries()) {
        if (other !== conn && other.playerId === player.id && other.roomCode === code) {
          try {
            otherWs.close(4001, 'superseded')
          } catch {
            /* noop */
          }
        }
      }

      conn.kind = 'player'
      conn.roomCode = code
      conn.playerId = player.id
      logger.info(`player ${player.name} joined ${code}`)
      send(ws, {
        t: 'welcome',
        kind: 'player',
        you: { id: player.id, name: player.name },
        token: player.token,
        code,
      })
      syncRoom(room)
    },

    start(ws, conn, msg) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'tv') return error_(ws, 'forbidden', 'Only the shared screen starts the ritual.')
      const res = startGame(room, sanitizeSettings(msg?.settings))
      if (res.error) {
        const messages = { need_players: `Gather ${LIMITS.minPlayers}–${LIMITS.maxPlayers} players first.` }
        return error_(ws, res.error, messages[res.error] ?? 'Cannot start.')
      }
      emitEvent(room, { kind: 'game_start', mode: room.settings.mode })
      if (room.match) {
        for (const ev of drainEvents(room.match)) emitEvent(room, { ...ev })
      }
      syncRoom(room)
    },

    advance(ws, conn) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'tv') return error_(ws, 'forbidden', 'Only the shared screen moves time.')
      doAdvance(room)
    },

    play_again(ws, conn) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'tv') return error_(ws, 'forbidden', 'Only the shared screen resets.')
      resetToLobby(room)
      emitEvent(room, { kind: 'back_to_lobby' })
      syncRoom(room)
    },

    end(ws, conn) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'tv') return error_(ws, 'forbidden', 'Only the shared screen ends it.')
      destroyRoom(room)
    },

    whisper_begin(ws, conn, msg) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'player') return error_(ws, 'forbidden', 'Not seated.')
      const res = openWhisper(room, conn.playerId, msg.toId)
      if (res.error) {
        const messages = {
          not_whisper_phase: 'The house forbids it now.',
          cannot_whisper_self: 'You cannot confess to yourself.',
          player_offline: 'Their phone has gone cold.',
          already_whispering: 'Finish your current whisper.',
        }
        return error_(ws, res.error, messages[res.error] ?? res.error)
      }
      syncRoom(room)
    },

    whisper_chunk(ws, conn, msg) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'player') return
      const res = chunkWhisper(room, conn.playerId, msg.text)
      if (res.error) error_(ws, res.error, 'The words slipped away.')
    },

    whisper_end(ws, conn) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'player') return
      const res = closeWhisper(room, conn.playerId)
      if (res.error) return error_(ws, res.error, 'Nothing was heard.')
      deliver(room, res)
      syncRoom(room)
    },

    whisper_cancel(ws, conn) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'player') return
      cancelWhisper(room, conn.playerId)
      syncRoom(room)
    },

    forge(ws, conn, msg) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'player') return error_(ws, 'forbidden', 'Not seated.')
      const res = forgeWhisper(room, conn.playerId, msg.toId, msg.text)
      if (res.error) {
        const messages = {
          forbidden: 'The tongue is not yours.',
          not_whisper_phase: 'The house forbids it now.',
          forge_used: 'Your borrowed voice is spent this round.',
          empty: 'Say something.',
          player_offline: 'Their phone has gone cold.',
        }
        return error_(ws, res.error, messages[res.error] ?? res.error)
      }
      deliver(room, res)
      syncRoom(room)
    },

    vote(ws, conn, msg) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'player') return error_(ws, 'forbidden', 'Not seated.')
      const res = castVote(room, conn.playerId, msg.targetId ?? null)
      if (res.error) return error_(ws, res.error, 'The ballot burned.')
      syncRoom(room)
    },

    /* ---------------- mansion board mode ---------------- */

    roll(ws, conn) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'player') return error_(ws, 'forbidden', 'Not seated.')
      const res = rollDiceEngine(room, conn.playerId)
      if (res.error) {
        const messages = {
          not_board_phase: 'The board is still.',
          not_your_turn: 'It is not your turn yet.',
          already_rolled: 'The dice have spoken.',
        }
        return error_(ws, res.error, messages[res.error] ?? res.error)
      }
      for (const ev of drainEvents(room.match)) emitEvent(room, { ...ev })
      syncRoom(room)
    },

    mg_input(ws, conn, msg) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'player') return
      const res = mgInputEngine(room, conn.playerId, msg.data)
      if (res.error) {
        // High-frequency inputs: walls/eliminations are normal play, stay quiet.
        const quiet = ['wall', 'already_caught', 'done_or_missing', 'bad_input']
        if (!quiet.includes(res.error)) return error_(ws, res.error, 'The house ignores that.')
        return
      }
      if (room.settings.mode === 'mansion') syncRoomThrottled(room, Date.now())
    },

    item_use(ws, conn, msg) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'player') return error_(ws, 'forbidden', 'Not seated.')
      const res = useItemEngine(room, conn.playerId, String(msg.itemId ?? ''), msg.targetId)
      if (res.error) {
        const messages = {
          not_your_turn: 'Wait for your turn.',
          too_late_for_items: 'Too late — the dice already rolled.',
          not_owned: 'You carry no such thing.',
          bad_target: 'Choose someone else.',
        }
        return error_(ws, res.error, messages[res.error] ?? res.error)
      }
      for (const ev of drainEvents(room.match)) emitEvent(room, { ...ev })
      syncRoom(room)
    },

    haunt(ws, conn, msg) {
      const room = roomOf(conn)
      if (!room || conn.kind !== 'player') return error_(ws, 'forbidden', 'Not seated.')
      const res = hauntEngine(room, conn.playerId, msg.targetId)
      if (res.error) {
        const messages = {
          nothing_to_haunt: 'No one within reach.',
          not_same_space: 'They must stand where you drift.',
          bad_target: 'Choose the living.',
        }
        return error_(ws, res.error, messages[res.error] ?? res.error)
      }
      for (const ev of drainEvents(room.match)) emitEvent(room, { ...ev })
      syncRoom(room)
    },

    ping(ws, conn, msg) {
      send(ws, { t: 'pong', ts: Number(msg.ts) || Date.now(), now: Date.now() })
    },
  }

  /* ---------------------------------------------------------------- */
  /* Connection lifecycle                                              */
  /* ---------------------------------------------------------------- */

  wss.on('connection', (ws) => {
    const conn = { ws, kind: null, roomCode: null, playerId: null, alive: true }
    conns.set(ws, conn)

    ws.on('pong', () => {
      conn.alive = true
    })

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return error_(ws, 'bad_json', 'Malformed whisper.')
      }
      if (!msg || typeof msg.t !== 'string') {
        return error_(ws, 'bad_message', 'Unknown shape.')
      }
      if (msg.t.length > 32 || String(raw).length > 16 * 1024) {
        return error_(ws, 'too_large', 'Too much.')
      }
      const handler = handlers[msg.t]
      if (!handler) return error_(ws, 'unknown_type', `Unknown "${msg.t}".`)
      try {
        handler(ws, conn, msg)
      } catch (err) {
        logger.error(`handler ${msg.t} failed:`, err?.stack ?? err)
        error_(ws, 'internal', 'The house stumbled.')
      }
    })

    ws.on('close', () => {
      conns.delete(ws)
      const room = roomOf(conn)
      if (room && conn.kind === 'player') {
        const me = findPlayer(room, conn.playerId)
        if (me) {
          me.connected = false
          cancelWhisper(room, me.id) // half-spoken whispers die with the phone
          syncRoom(room)
        }
      }
    })

    ws.on('error', (err) => {
      logger.debug('ws error:', err?.message ?? err)
    })
  })

  wss.on('close', () => {
    clearInterval(ticker)
    clearInterval(heartbeat)
  })

  logger.info(`WHISPER hub ready at ws://0.0.0.0:${config.port}/whisper`)

  return {
    wss,
    rooms,
    /** Test/debug helper: force-advance every timed room immediately. */
    flushTimers: () => {
      const now = Date.now()
      for (const room of rooms.values()) {
        if (room.settings.mode === 'mansion' && room.match) {
          for (const ev of mansionTickEngine(room, now)) emitEvent(room, { ...ev })
          continue
        }
        if (room.phaseEndsAt && now >= room.phaseEndsAt) doAdvance(room, now)
      }
    },
    /**
     * Test/debug helper: sweep a mansion room's clock forward by `ms`,
     * ticking the engine every TICK_MS so movement/minigames progress.
     */
    stepMansion: (code, ms = 1000) => {
      const room = rooms.get(code)
      if (!room?.match) return []
      const events = []
      const end = Date.now() + ms
      for (let t = Date.now(); t <= end; t += TICK_MS) {
        events.push(...mansionTickEngine(room, Math.min(t, end)))
      }
      for (const ev of events) emitEvent(room, { ...ev })
      syncRoom(room)
      return events
    },
  }
}
