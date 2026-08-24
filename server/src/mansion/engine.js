/**
 * MANSION — server-authoritative board-game engine.
 *
 * Pure logic over `room.match`; no sockets, no timers of its own. The hub's
 * ticker calls `mansionTick()` every ~500ms and the TV can force
 * `mansionAdvance()`. All randomness lives here so clients only ever replay
 * authoritative snapshots/events.
 *
 * Phase map (room.phase when room.mode === 'mansion'):
 *   board_intro      cinematic "the house wakes" (timed)
 *   board            turn loop (idle auto-roll, stepped movement)
 *   minigame_intro   dramatic transition (timed)
 *   minigame         play window per MINIGAMES[id].durationMs
 *   minigame_results scoreboard + soul awards (timed)
 *   results          final standings; winner reveal; stays until play_again/end
 */

import {
  BOARD,
  STAGES,
  stageForProgress,
  ITEMS,
  ITEM_IDS,
  CURSES,
  CURSE_IDS,
  MYSTERIES,
  HORROR_EVENTS,
  SPACE_COPY,
  MINIGAMES,
  MINIGAME_IDS,
  RANK_REWARDS,
  MINIGAME_EVERY_TURNS,
  MATCH_TUNING,
} from './content.js'
import { MINIGAME_RUNTIMES, mgPublicState, eyeIsOpen } from './minigames.js'

const d6 = () => 1 + Math.floor(Math.random() * 6)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const clampSouls = (n) => Math.max(0, Math.min(99, n))

/* ------------------------------------------------------------------ */
/* House bots                                                          */
/* ------------------------------------------------------------------ */

/**
 * Bots are seated from the TV lobby so a lone player can fill the table.
 * Everything they do happens inside mansionTick — no sockets of their own:
 *   - they answer the dice in seconds instead of idling 20s,
 *   - they sometimes spend an item before rolling,
 *   - ghost bots take the best haunt on offer,
 *   - they play every minigame with simple heuristics.
 */
export const BOT_TUNING = {
  rollMinMs: 1400,
  rollMaxMs: 4200,
  hauntDelayMs: 1800,
  itemChance: 0.45,
  voteDelayFrac: 0.35,
  moveMinMs: 450,
  moveMaxMs: 900,
}

const isBot = (room, playerId) =>
  room.players.find((p) => p.id === playerId)?.bot === true

const botRand = (min, max) => min + Math.random() * (max - min)

function weightedMystery() {
  const total = MYSTERIES.reduce((n, m) => n + m.weight, 0)
  let roll = Math.random() * total
  for (const m of MYSTERIES) {
    roll -= m.weight
    if (roll <= 0) return m
  }
  return MYSTERIES[MYSTERIES.length - 1]
}

/* ------------------------------------------------------------------ */
/* Match lifecycle                                                     */
/* ------------------------------------------------------------------ */

export function createMatch(room, settings = {}, now = Date.now()) {
  const laps = settings.laps ?? 3
  const order = [...room.players].sort(() => Math.random() - 0.5).map((p) => p.id)

  room.match = {
    order,
    currentIdx: -1,
    currentPlayerId: null,
    turnCount: 0,
    totalTurns: order.length * laps,
    stage: 0,
    awaiting: null, // 'roll' | 'move' | 'haunt'
    turnDeadline: null,
    pendingMove: null, // { playerId, remaining, nextAt, depth }
    haunt: null, // { playerId, deadline }
    lastRoll: null, // { playerId, value, effective }
    lastSpace: null, // { pos, type, name } — camera zoom hooks
    mgBag: [], // shuffled minigame rotation
    mgId: null,
    mgResults: null, // rows after a minigame finishes
    results: null, // final standings at phase === 'results'
    log: [],
    mp: new Map(
      room.players.map((p) => [
        p.id,
        {
          pos: 0,
          souls: 0,
          status: 'alive', // 'alive' | 'ghost'
          items: [],
          curses: [],
          featherNext: false,
          saltShield: false,
          snuffedNext: false, // victim of a Snuffed Candle
        },
      ])
    ),
    _events: [],
  }

  enterPhase(room, 'board_intro', now)
  emit(room, { kind: 'match_start' })
  return { ok: true }
}

export function resetMatch(room) {
  room.match = null
}

function enterPhase(room, phase, now = Date.now()) {
  room.phase = phase
  const dur = mansionPhaseMs(room, phase)
  room.phaseEndsAt = dur ? now + dur : null
}

export function mansionPhaseMs(room, phase) {
  switch (phase) {
    case 'board_intro':
      return 5000
    case 'minigame_intro':
      return MATCH_TUNING.minigameIntroMs
    case 'minigame':
      return MINIGAMES[room.match?.mgId]?.durationMs ?? 15000
    case 'minigame_results':
      return MATCH_TUNING.minigameResultsMs
    default:
      return null // board & results are event/idle driven
  }
}

/* ------------------------------------------------------------------ */
/* Events & log                                                        */
/* ------------------------------------------------------------------ */

function emit(room, event) {
  room.match?._events.push(event)
}

export function drainEvents(match) {
  const events = match._events
  match._events = []
  return events
}

function logLine(room, line, extra = {}) {
  room.match.log.push({ line, at: Date.now(), ...extra })
  if (room.match.log.length > 30) room.match.log.splice(0, room.match.log.length - 30)
}

/* ------------------------------------------------------------------ */
/* Turn engine                                                         */
/* ------------------------------------------------------------------ */

function currentPlayerId(match) {
  return match.currentPlayerId
}

function beginNextTurn(room, now) {
  const m = room.match
  m.currentIdx = (m.currentIdx + 1) % m.order.length
  m.currentPlayerId = m.order[m.currentIdx]
  m.awaiting = 'roll'
  // Bots answer quickly; humans get the full idle window.
  m.turnDeadline =
    now +
    (isBot(room, m.currentPlayerId)
      ? botRand(BOT_TUNING.rollMinMs, BOT_TUNING.rollMaxMs)
      : MATCH_TUNING.turnIdleMs)
  m.lastRoll = null
  emit(room, { kind: 'turn_start', playerId: m.currentPlayerId })
}

/** Progress through the match drives how awake the mansion is. */
function refreshStage(room) {
  const m = room.match
  const fraction = m.turnCount / Math.max(1, m.totalTurns)
  const next = stageForProgress(fraction)
  if (next !== m.stage) {
    m.stage = next
    emit(room, { kind: 'stage_change', stage: next, name: STAGES[next].name })
    logLine(room, `The house grows ${STAGES[next].name.toLowerCase()}…`)
  }
}

function completeTurn(room, now) {
  const m = room.match
  m.turnCount += 1
  m.awaiting = null
  m.haunt = null
  m.pendingMove = null
  refreshStage(room)

  if (m.turnCount >= m.totalTurns) {
    finishMatch(room)
    return
  }
  if (m.turnCount % MINIGAME_EVERY_TURNS === 0 && !m.mgId) {
    enterPhase(room, 'minigame_intro', now)
    emit(room, { kind: 'minigame_soon' })
    return
  }
  beginNextTurn(room, now)
}

function drawMinigameId(m) {
  if (m.mgBag.length === 0) m.mgBag = [...MINIGAME_IDS].sort(() => Math.random() - 0.5)
  return m.mgBag.pop()
}

function startMinigameRuntime(room, now) {
  const m = room.match
  m.mgId = drawMinigameId(m)
  m.mgResults = null
  const players = room.players.filter((p) => p.connected || true) // ghosts play too
  const runtime = MINIGAME_RUNTIMES[m.mgId]
  m.mgState = runtime.start(players, m.stage, now)
  enterPhase(room, 'minigame', now)
  emit(room, {
    kind: 'minigame_start',
    id: m.mgId,
    name: MINIGAMES[m.mgId].name,
    tagline: MINIGAMES[m.mgId].tagline,
  })
  logLine(room, `${MINIGAMES[m.mgId].name} begins.`)
}

function applyReward(room, playerId, baseDelta) {
  const mp = room.match.mp.get(playerId)
  let delta = baseDelta
  if (delta > 0) {
    if (mp.snuffedNext) delta = Math.floor(delta / 2)
    if (mp.curses.includes('dim_eyes')) {
      delta = Math.floor(delta / 2)
      removeCurse(mp, 'dim_eyes')
    }
    if (mp.curses.includes('greedy_pockets')) {
      delta -= 1
      removeCurse(mp, 'greedy_pockets')
    }
    if (mp.status === 'ghost') delta = Math.ceil(delta / 2)
  }
  if (delta !== 0) {
    mp.souls = clampSouls(mp.souls + delta)
  }
  mp.snuffedNext = false
  return delta
}

function finishMinigame(room, now) {
  const m = room.match
  const runtime = MINIGAME_RUNTIMES[m.mgId]
  const rawRows = runtime.finish(m.mgState)

  if (MINIGAMES[m.mgId].kind === 'secret_vote') {
    // Custom deltas straight from the altar; the altar can take you at zero.
    m.mgResults = rawRows.map((r) => {
      const mp = m.mp.get(r.playerId)
      const before = mp.souls
      const delta = r.delta ?? 0
      if (delta !== 0) mp.souls = clampSouls(mp.souls + delta)
      if (delta < 0 && before > 0 && mp.souls <= 0) killPlayer(room, r.playerId)
      return { playerId: r.playerId, score: r.score, note: r.note, soulsDelta: delta }
    })
  } else {
    m.mgResults = rawRows.map((r, i) => {
      const rankReward = RANK_REWARDS[i] ?? 0
      return {
        playerId: r.playerId,
        score: r.score,
        note: r.note,
        soulsDelta: applyReward(room, r.playerId, rankReward),
      }
    })
  }

  for (const row of m.mgResults) {
    if (row.soulsDelta !== 0) {
      logLine(room, `${nameOf(room, row.playerId)} ${row.soulsDelta > 0 ? '+' : ''}${row.soulsDelta} souls — ${row.note}`)
    }
  }

  emit(room, {
    kind: 'minigame_end',
    id: m.mgId,
    scores: m.mgResults.map((r) => ({ playerId: r.playerId, score: r.score })),
  })

  enterPhase(room, 'minigame_results', now)
}

function closeMinigame(room, now) {
  const m = room.match
  m.mgId = null
  m.mgState = null
  enterPhase(room, 'board', now)
  beginNextTurn(room, now)
}

function finishMatch(room) {
  const m = room.match
  const rows = m.order
    .map((id) => ({ playerId: id, souls: m.mp.get(id).souls, status: m.mp.get(id).status }))
    .sort((a, b) => b.souls - a.souls)
  const top = rows[0]?.souls ?? 0
  const winnerIds = rows.filter((r) => r.souls === top).map((r) => r.playerId)
  m.results = { rows, winnerIds, stage: m.stage }
  enterPhase(room, 'results')
  emit(room, { kind: 'winner', playerIds: winnerIds })
  logLine(room, 'The candles go out one by one. The counting is done.')
}

/* ------------------------------------------------------------------ */
/* Dice & movement                                                     */
/* ------------------------------------------------------------------ */

export function rollDice(room, playerId, now = Date.now()) {
  const m = room.match
  if (!m || room.phase !== 'board') return { error: 'not_board_phase' }
  if (playerId !== currentPlayerId(m)) return { error: 'not_your_turn' }
  if (m.awaiting !== 'roll') return { error: 'already_rolled' }

  const mp = m.mp.get(playerId)
  let value = d6()
  let effective = value
  if (mp.featherNext) {
    mp.featherNext = false
    effective = Math.max(effective, 4)
  }
  if (mp.curses.includes('heavy_boots')) {
    removeCurse(mp, 'heavy_boots')
    effective = Math.max(1, effective - 1)
  }

  m.lastRoll = { playerId, value, effective }
  m.awaiting = 'move'
  m.pendingMove = { playerId, remaining: effective, nextAt: now + 350, depth: 0 }
  emit(room, { kind: 'roll_result', playerId, value, effective })
  logLine(room, `${nameOf(room, playerId)} rolls a ${effective}.`)
  return { ok: true }
}

function stepOnce(room, now) {
  const m = room.match
  const pend = m.pendingMove
  const mp = m.mp.get(pend.playerId)
  mp.pos = (mp.pos + 1) % BOARD.length
  pend.remaining -= 1
  pend.nextAt = now + MATCH_TUNING.stepMs

  const space = BOARD[mp.pos]
  m.lastSpace = { pos: mp.pos, type: space.type, name: space.name }
  emit(room, { kind: 'step', playerId: pend.playerId, pos: mp.pos })

  if (pend.remaining <= 0) {
    m.pendingMove = null
    resolveSpace(room, pend.playerId, mp.pos, pend.depth, now)
  }
}

/* ------------------------------------------------------------------ */
/* Space resolution                                                    */
/* ------------------------------------------------------------------ */

function alivePlayers(room) {
  return room.players.filter((p) => room.match.mp.get(p.id)?.status === 'alive')
}

function nameOf(room, playerId) {
  return room.players.find((p) => p.id === playerId)?.name ?? 'someone'
}

function addCurse(mp, curseId) {
  if (!CURSES[curseId]) return
  if (mp.curses.includes(curseId)) return
  if (mp.curses.length >= 3) mp.curses.shift()
  mp.curses.push(curseId)
}

function removeCurse(mp, curseId) {
  const i = mp.curses.indexOf(curseId)
  if (i >= 0) mp.curses.splice(i, 1)
}

/** Central harm funnel: salt wards absorb; hitting zero claims you. */
function harm(room, targetId, amount, why) {
  const m = room.match
  const mp = m.mp.get(targetId)
  if (!mp || mp.status !== 'alive') return

  if (mp.saltShield || mp.items.includes('salt_jar')) {
    mp.saltShield = false
    mp.items = mp.items.filter((i) => i !== 'salt_jar')
    emit(room, { kind: 'ward_block', playerId: targetId })
    logLine(room, `Salt flares white. The ${why} breaks around ${nameOf(room, targetId)}.`)
    return
  }

  mp.souls = clampSouls(mp.souls - amount)
  emit(room, { kind: 'harm', playerId: targetId, amount })
  logLine(room, `${nameOf(room, targetId)} loses ${amount} soul${amount > 1 ? 's' : ''} — ${why}.`)
  if (mp.souls <= 0) killPlayer(room, targetId)
}

function killPlayer(room, targetId) {
  const m = room.match
  const mp = m.mp.get(targetId)
  mp.status = 'ghost'
  mp.souls = 0
  mp.pos = mp.pos // stays where it fell
  emit(room, { kind: 'player_dead', playerId: targetId })
  logLine(room, `THE HOUSE TAKES ${nameOf(room, targetId).toUpperCase()}. They drift now.`)
}

function revivePlayer(room, targetId) {
  const m = room.match
  const mp = m.mp.get(targetId)
  if (mp.status !== 'ghost') return
  mp.status = 'alive'
  mp.souls = Math.max(1, mp.souls)
  emit(room, { kind: 'revived', playerId: targetId })
  logLine(room, `${nameOf(room, targetId)} steps back into candlelight. Alive again.`)
}

function grantItem(room, playerId) {
  const mp = room.match.mp.get(playerId)
  if (mp.items.length >= 3) {
    logLine(room, `${nameOf(room, playerId)} finds nothing their hands can hold.`)
    return
  }
  const owned = new Set(mp.items)
  const options = ITEM_IDS.filter((i) => !owned.has(i))
  if (!options.length) return
  const itemId = pick(options)
  mp.items.push(itemId)
  if (itemId === 'salt_jar') mp.saltShield = true
  emit(room, { kind: 'item_found', playerId, itemId })
  logLine(room, `${nameOf(room, playerId)} pockets the ${ITEMS[itemId].name}.`)
}

function chainMove(room, playerId, extra, depth, now) {
  if (depth >= 3) return
  room.match.pendingMove = {
    playerId,
    remaining: ((extra % BOARD.length) + BOARD.length) % BOARD.length,
    nextAt: now + MATCH_TUNING.stepMs,
    depth: depth + 1,
  }
}

function resolveSpace(room, playerId, pos, depth, now) {
  const m = room.match
  const mp = m.mp.get(playerId)
  const space = BOARD[pos]

  if (mp.status === 'ghost') {
    // Ghosts drift: nothing touches them except sanctuary — and prey.
    if (space.type === 'safe') {
      revivePlayer(room, playerId)
      if (mp.curses.length) {
        mp.curses = []
        emit(room, { kind: 'curses_cleared', playerId })
        logLine(room, `Candlelight in the ${space.name}. ${nameOf(room, playerId)} feels lighter.`)
      }
      completeTurnAfterResolve(room, now)
      return
    }
    logLine(room, `${nameOf(room, playerId)} drifts through the ${space.name}, unfelt.`)
    const prey = alivePlayers(room).filter((p) => m.mp.get(p.id).pos === mp.pos)
    if (prey.length) {
      m.awaiting = 'haunt'
      m.haunt = {
        playerId,
        deadline: now + MATCH_TUNING.hauntWindowMs,
        ...(isBot(room, playerId)
          ? { botAt: now + BOT_TUNING.hauntDelayMs }
          : {}),
      }
      emit(room, { kind: 'haunt_offer', playerId, targets: prey.map((p) => p.id) })
      return
    }
    completeTurnAfterResolve(room, now)
    return
  }

  switch (space.type) {
    case 'start':
      logLine(room, `${nameOf(room, playerId)} passes the locked front door. It rattles politely.`)
      break

    case 'soul': {
      mp.souls = clampSouls(mp.souls + 1)
      emit(room, { kind: 'soul_gain', playerId, amount: 1 })
      logLine(room, `${nameOf(room, playerId)} cups a stray soul. +1.`)
      break
    }

    case 'item':
      grantItem(room, playerId)
      break

    case 'curse': {
      if (mp.saltShield || mp.items.includes('salt_jar')) {
        mp.saltShield = false
        mp.items = mp.items.filter((i) => i !== 'salt_jar')
        emit(room, { kind: 'ward_block', playerId })
        logLine(room, `The salt circle saves ${nameOf(room, playerId)} from what clings here.`)
      } else {
        const owned = new Set(mp.curses)
        const options = CURSE_IDS.filter((c) => !owned.has(c))
        if (options.length) {
          const c = pick(options)
          addCurse(mp, c)
          emit(room, { kind: 'cursed', playerId, curse: c })
          logLine(room, `${nameOf(room, playerId)} — ${CURSES[c].text}`)
        }
      }
      break
    }

    case 'mystery': {
      const mystery = weightedMystery()
      emit(room, { kind: 'mystery', playerId, id: mystery.id, text: mystery.line })
      logLine(room, mystery.line)
      const fx = mystery.effect
      if (fx.souls) mp.souls = clampSouls(mp.souls + fx.souls)
      if (fx.item) grantItem(room, playerId)
      if (fx.collect) {
        let taken = 0
        for (const other of alivePlayers(room)) {
          if (other.id === playerId || taken >= 3) continue
          const omp = m.mp.get(other.id)
          if (omp.souls > 0) {
            omp.souls -= 1
            mp.souls += 1
            taken += 1
            emit(room, { kind: 'harm', playerId: other.id, amount: 1 })
          }
        }
        if (taken) logLine(room, `${taken} guest${taken > 1 ? 's' : ''} pay the tithe.`)
      }
      if (fx.swap_random) {
        const others = alivePlayers(room).filter((p) => p.id !== playerId)
        if (others.length) {
          const victim = pick(others)
          const vmp = m.mp.get(victim.id)
          const tmp = mp.pos
          mp.pos = vmp.pos
          vmp.pos = tmp
          emit(room, { kind: 'swap', a: playerId, b: victim.id })
          logLine(room, `The house trades ${nameOf(room, playerId)} with ${nameOf(room, victim.id)}.`)
        }
      }
      if (typeof fx.move === 'number' && fx.move !== 0) {
        if (fx.move < 0) mp.pos = (mp.pos + fx.move + BOARD.length * 2) % BOARD.length
        else {
          chainMove(room, playerId, fx.move, depth, now)
          return // movement continues before the turn completes
        }
      }
      break
    }

    case 'horror': {
      const valid = HORROR_EVENTS.filter((e) => e.stages.includes(m.stage))
      const ev = pick(valid)
      emit(room, { kind: 'horror', id: ev.id, text: ev.line, stage: m.stage })
      logLine(room, ev.line)

      const markedTarget = () => {
        if (mp.curses.includes('marked')) {
          removeCurse(mp, 'marked')
          return playerId
        }
        return null
      }

      const fx = ev.effect
      if (fx.scare) {
        // pure dread, no mechanical harm
      } else if (typeof fx.lose_souls_target === 'number') {
        const t = markedTarget() ?? pick(alivePlayers(room)).id
        harm(room, t, fx.lose_souls_target, 'the cold had teeth')
      } else if (fx.contest_roll_low_loses) {
        const entrants = alivePlayers(room)
        const rolls = entrants.map((p) => ({ id: p.id, r: d6() }))
        emit(room, { kind: 'contest', rolls })
        const low = Math.min(...rolls.map((x) => x.r))
        const losers = rolls.filter((x) => x.r === low)
        const unlucky = pick(losers).id
        logLine(room, `${nameOf(room, unlucky)} drew the short breath.`)
        harm(room, unlucky, fx.contest_roll_low_loses, 'it chose the coldest hand')
      } else if (fx.kill_marked_or_random) {
        const t = markedTarget() ?? pick(alivePlayers(room)).id
        const tmp = m.mp.get(t)
        if (tmp.souls <= 0 || Math.random() < 0.25) {
          killPlayer(room, t)
        } else {
          harm(room, t, 1, 'it tasted them and set them down')
        }
      }
      break
    }

    case 'shortcut': {
      logLine(room, `${SPACE_COPY.shortcut} +3.`)
      emit(room, { kind: 'shortcut', playerId })
      chainMove(room, playerId, 3, depth, now)
      return
    }

    case 'safe':
      if (mp.curses.length) {
        mp.curses = []
        emit(room, { kind: 'curses_cleared', playerId })
        logLine(room, `Candlelight in the ${space.name}. ${nameOf(room, playerId)} feels lighter.`)
      }
      break

    default:
      break
  }

  completeTurnAfterResolve(room, now)
}

function completeTurnAfterResolve(room, now) {
  const m = room.match
  const lastPos = m.mp.get(currentPlayerId(m))?.pos
  if (lastPos != null) {
    const space = BOARD[lastPos]
    emit(room, {
      kind: 'space_result',
      playerId: currentPlayerId(m),
      pos: lastPos,
      type: space.type,
      text: SPACE_COPY[space.type] ?? '',
    })
  }
  completeTurn(room, now)
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export function useItem(room, playerId, itemId, targetId, now = Date.now()) {
  const m = room.match
  if (!m || room.phase !== 'board') return { error: 'not_board_phase' }
  if (playerId !== currentPlayerId(m)) return { error: 'not_your_turn' }
  if (m.awaiting !== 'roll') return { error: 'too_late_for_items' }

  const mp = m.mp.get(playerId)
  const idx = mp.items.indexOf(itemId)
  if (idx < 0) return { error: 'not_owned' }
  const def = ITEMS[itemId]
  if (!def) return { error: 'unknown_item' }

  if (def.needsTarget) {
    const target = findMp(room, targetId)
    if (!target || target.playerId === playerId) return { error: 'bad_target' }
  }

  mp.items.splice(idx, 1)
  emit(room, { kind: 'item_used', playerId, itemId, targetId: targetId ?? null })

  switch (itemId) {
    case 'voodoo_doll': {
      const tmp = m.mp.get(targetId)
      if (tmp.souls <= 0) {
        logLine(room, `The doll goes limp. ${nameOf(room, targetId)} has nothing to take.`)
        mp.items.push(itemId) // refund — wasted items feel bad
      } else {
        tmp.souls = clampSouls(tmp.souls - 1)
        mp.souls = clampSouls(mp.souls + 1)
        logLine(room, `${nameOf(room, playerId)} squeezes the doll. ${nameOf(room, targetId)} shivers. +1.`)
        emit(room, { kind: 'harm', playerId: targetId, amount: 1 })
      }
      break
    }
    case 'black_feather':
      mp.featherNext = true
      logLine(room, `${nameOf(room, playerId)} ties a feather to their wrist. Next roll ≥4.`)
      break
    case 'iron_key': {
      // Walk forward to the nearest safe room.
      let hops = 0
      do {
        mp.pos = (mp.pos + 1) % BOARD.length
        hops++
      } while (BOARD[mp.pos].type !== 'safe' && hops < BOARD.length)
      logLine(room, `An iron door opens where a wall should be. ${nameOf(room, playerId)} skips ahead.`)
      break
    }
    case 'snuffed_candle': {
      const tmp = m.mp.get(targetId)
      tmp.snuffedNext = true
      logLine(room, `${nameOf(room, playerId)} pinches a flame on ${nameOf(room, targetId)}'s behalf. Half light in the next game.`)
      break
    }
    case 'salt_jar':
      mp.saltShield = true
      logLine(room, `${nameOf(room, playerId)} pours a careful circle.`)
      break
    default:
      break
  }
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Ghost hauntings                                                     */
/* ------------------------------------------------------------------ */

export function haunt(room, playerId, targetId, now = Date.now()) {
  const m = room.match
  if (!m || room.phase !== 'board') return { error: 'not_board_phase' }
  if (playerId !== currentPlayerId(m)) return { error: 'not_your_turn' }
  if (m.awaiting !== 'haunt') return { error: 'nothing_to_haunt' }

  const me = m.mp.get(playerId)
  const target = findMp(room, targetId)
  if (!target || target.playerId === playerId) return { error: 'bad_target' }
  if (me.pos !== target.state.pos) return { error: 'not_same_space' }
  if (target.state.status !== 'alive') return { error: 'bad_target' }

  if (target.state.souls > 0) {
    target.state.souls = clampSouls(target.state.souls - 1)
    me.souls = clampSouls(me.souls + 1)
    emit(room, { kind: 'haunt_steal', ghostId: playerId, targetId })
    logLine(room, `${nameOf(room, playerId)} reaches through ${nameOf(room, targetId)}. A soul crosses over. +1.`)
  } else {
    addCurse(target.state, 'heavy_boots')
    emit(room, { kind: 'haunt_spook', ghostId: playerId, targetId })
    logLine(room, `${nameOf(room, playerId)} breathes frost down ${nameOf(room, targetId)}'s neck.`)
  }
  m.awaiting = null
  m.haunt = null
  completeTurn(room, now)
  return { ok: true }
}

function findMp(room, playerId) {
  if (!playerId) return null
  const state = room.match?.mp.get(playerId)
  return state ? { playerId, state } : null
}

/* ------------------------------------------------------------------ */
/* Minigame inputs                                                     */
/* ------------------------------------------------------------------ */

export function mgInput(room, playerId, data, now = Date.now()) {
  const m = room.match
  if (!m || room.phase !== 'minigame' || !m.mgId) return { error: 'no_minigame' }
  if (data == null || typeof data !== 'object') return { error: 'bad_input' }
  const runtime = MINIGAME_RUNTIMES[m.mgId]
  const res = runtime.input(m.mgState, playerId, data, now)
  if (res.error) return res
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Bot instincts                                                       */
/* ------------------------------------------------------------------ */

/** Bots spend an item on their own turn before rolling (priority order). */
function chooseBotItem(room, m, mp) {
  const others = () =>
    room.players
      .filter((p) => p.id !== m.currentPlayerId)
      .map((p) => ({ id: p.id, s: m.mp.get(p.id) }))
      .filter((o) => o.s.status === 'alive')
      .sort((a, b) => b.s.souls - a.s.souls)

  if (mp.items.includes('voodoo_doll')) {
    const t = others()[0]
    if (t && t.s.souls > 0) return ['voodoo_doll', t.id]
  }
  if (mp.items.includes('snuffed_candle')) {
    const pool = others()
    if (pool.length) return ['snuffed_candle', pick(pool).id]
  }
  if (mp.items.includes('black_feather')) return ['black_feather', null]
  if (mp.items.includes('iron_key')) return ['iron_key', null]
  return null
}

/**
 * Board-phase instincts for the bot on turn: maybe an item, then the
 * shortened deadline auto-rolls for them.
 */
function botBoardTurn(room, m, now) {
  if (m.awaiting !== 'roll') return
  const pid = m.currentPlayerId
  if (!isBot(room, pid)) return
  const mp = m.mp.get(pid)
  if (!mp || !mp.items.length) return
  if (m._botItemCheck === m.turnCount) return // already made up its mind
  m._botItemCheck = m.turnCount
  if (Math.random() >= BOT_TUNING.itemChance) return // decided: hold onto them
  const choice = chooseBotItem(room, m, mp)
  if (choice) useItem(room, pid, choice[0], choice[1], now)
}

/** Ghost bots take the richest soul standing where they drift. */
function botHauntChoice(room, m) {
  const ghostId = m.haunt.playerId
  const me = m.mp.get(ghostId)
  if (!me) return null
  const prey = room.players
    .map((p) => ({ id: p.id, s: m.mp.get(p.id) }))
    .filter((o) => o.id !== ghostId && o.s.status === 'alive' && o.s.pos === me.pos)
    .sort((a, b) => b.s.souls - a.s.souls)
  return prey[0]?.id ?? null
}

/** BFS through the maze bitmask grid — first step toward the exit. */
function mazeFirstStep(state, from) {
  const idx = (x, y) => y * state.w + x
  const DIRS = [
    [0, -1, 'up', 1],
    [1, 0, 'right', 2],
    [0, 1, 'down', 4],
    [-1, 0, 'left', 8],
  ]
  const prev = new Map([[idx(from.x, from.y), null]])
  const queue = [[from.x, from.y]]
  while (queue.length) {
    const [x, y] = queue.shift()
    const cell = state.cells[idx(x, y)]
    for (const [dx, dy, dir, bit] of DIRS) {
      if (!(cell & bit)) continue
      const nx = x + dx
      const ny = y + dy
      const key = idx(nx, ny)
      if (prev.has(key)) continue
      prev.set(key, { x, y, dir })
      if (nx === state.exit.x && ny === state.exit.y) {
        let node = prev.get(key)
        while (prev.get(idx(node.x, node.y))) node = prev.get(idx(node.x, node.y))
        return node.dir
      }
      queue.push([nx, ny])
    }
  }
  return null
}

/** Feed every seated bot its minigame inputs for this tick. */
function botMinigameInputs(room, m, now) {
  const bots = room.players.filter((p) => p.bot)
  if (!bots.length || !m.mgId) return
  const def = MINIGAMES[m.mgId]

  switch (def.kind) {
    case 'taps':
      for (const b of bots) {
        const n = 2 + Math.floor(Math.random() * 3)
        for (let i = 0; i < n; i++) mgInput(room, b.id, { type: 'tap' }, now)
      }
      break

    case 'lanes':
      for (const b of bots) {
        const r = m.mgState.racers.get(b.id)
        if (!r || r.caughtAt) continue
        const wantRun = r.stamina > 28
        if (wantRun !== r.running) {
          mgInput(room, b.id, { type: wantRun ? 'run_on' : 'run_off' }, now)
        }
      }
      break

    case 'gated_taps': {
      if (eyeIsOpen(m.mgState, now)) break
      for (const b of bots) {
        const n = 1 + Math.floor(Math.random() * 3)
        for (let i = 0; i < n; i++) mgInput(room, b.id, { type: 'tap' }, now)
      }
      break
    }

    case 'secret_vote': {
      const durationMs = def.durationMs ?? 15000
      const elapsed = durationMs - Math.max(0, (room.phaseEndsAt ?? now) - now)
      if (elapsed < durationMs * BOT_TUNING.voteDelayFrac) break
      for (const b of bots) {
        if (m.mgState.votes.has(b.id)) continue
        const options = m.mgState.eligible.filter((id) => id !== b.id)
        if (!options.length) continue
        mgInput(room, b.id, { type: 'vote', targetId: pick(options) }, now)
      }
      break
    }

    case 'grid': {
      const nextAt = (m._botMazeNext ??= new Map())
      for (const b of bots) {
        const p = m.mgState.pos.get(b.id)
        if (!p || m.mgState.doneOrder.includes(b.id)) continue
        if ((nextAt.get(b.id) ?? 0) > now) continue
        nextAt.set(b.id, now + botRand(BOT_TUNING.moveMinMs, BOT_TUNING.moveMaxMs))
        const dir = mazeFirstStep(m.mgState, p)
        if (dir) mgInput(room, b.id, { type: 'move', dir }, now)
      }
      break
    }

    default:
      break
  }
}

/* ------------------------------------------------------------------ */
/* Tick & advance                                                      */
/* ------------------------------------------------------------------ */

/**
 * Called every hub tick (~500ms) for mansion rooms. Drives idle auto-rolls,
 * movement animation beats, minigame simulation and every phase deadline.
 * Returns events to emit.
 */
export function mansionTick(room, now = Date.now()) {
  const m = room.match
  if (!m) return []
  const runtime = m.mgId ? MINIGAME_RUNTIMES[m.mgId] : null

  switch (room.phase) {
    case 'board_intro':
      if (room.phaseEndsAt && now >= room.phaseEndsAt) {
        enterPhase(room, 'board', now)
        beginNextTurn(room, now)
      }
      break

    case 'board': {
      botBoardTurn(room, m, now)
      if (m.awaiting === 'roll' && m.turnDeadline && now >= m.turnDeadline) {
        // AFK insurance: the house rolls for you.
        rollDice(room, currentPlayerId(m), now)
      }
      if (m.awaiting === 'move' && m.pendingMove && now >= m.pendingMove.nextAt) {
        stepOnce(room, now)
      }
      if (m.awaiting === 'haunt' && m.haunt) {
        const botTarget =
          m.haunt.botAt != null && now >= m.haunt.botAt && isBot(room, m.haunt.playerId)
            ? botHauntChoice(room, m)
            : null
        if (botTarget) {
          haunt(room, m.haunt.playerId, botTarget, now)
        } else if (now >= m.haunt.deadline) {
          logLine(room, `${nameOf(room, currentPlayerId(m))} lets the moment pass.`)
          m.awaiting = null
          m.haunt = null
          completeTurn(room, now)
        }
      }
      break
    }

    case 'minigame_intro':
      if (room.phaseEndsAt && now >= room.phaseEndsAt) startMinigameRuntime(room, now)
      break

    case 'minigame': {
      let changed = false
      botMinigameInputs(room, m, now)
      if (runtime?.tick) changed = Boolean(runtime.tick(m.mgState, now))
      if (changed) emit(room, { kind: 'mg_sync' })
      if (room.phaseEndsAt && now >= room.phaseEndsAt) finishMinigame(room, now)
      break
    }

    case 'minigame_results':
      if (room.phaseEndsAt && now >= room.phaseEndsAt) closeMinigame(room, now)
      break

    default:
      break
  }

  return drainEvents(m)
}

/** TV-forced advance ("skip ahead"). */
export function mansionAdvance(room, now = Date.now()) {
  const m = room.match
  if (!m) return []
  switch (room.phase) {
    case 'board_intro':
      enterPhase(room, 'board', now)
      beginNextTurn(room, now)
      break
    case 'board':
      if (m.awaiting === 'roll') rollDice(room, currentPlayerId(m), now)
      while (room.phase === 'board' && m.awaiting === 'move' && m.pendingMove) {
        stepOnce(room, now)
      }
      if (room.phase === 'board' && m.awaiting === 'haunt') {
        m.awaiting = null
        m.haunt = null
        completeTurn(room, now)
      }
      break
    case 'minigame_intro':
      startMinigameRuntime(room, now)
      break
    case 'minigame':
      finishMinigame(room, now)
      break
    case 'minigame_results':
      closeMinigame(room, now)
      break
    default:
      break
  }
  return drainEvents(m)
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** Public chunk merged into BOTH tvView and playerView snapshots. */
export function matchPublic(room, now = Date.now()) {
  const m = room.match
  if (!m) return null
  return {
    order: [...m.order],
    currentPlayerId: m.currentPlayerId,
    turnCount: m.turnCount,
    totalTurns: m.totalTurns,
    stage: m.stage,
    stageName: STAGES[m.stage].name,
    awaiting: m.awaiting,
    turnDeadline: m.turnDeadline,
    players: m.order.map((id) => {
      const p = room.players.find((pl) => pl.id === id)
      const s = m.mp.get(id)
      return {
        id,
        name: p?.name ?? '?',
        connected: p?.connected ?? false,
        bot: p?.bot === true,
        pos: s.pos,
        souls: s.souls,
        status: s.status,
        itemCount: s.items.length,
        curses: [...s.curses],
        isTurn: id === m.currentPlayerId,
      }
    }),
    lastRoll: m.lastRoll ? { ...m.lastRoll } : null,
    lastSpace: m.lastSpace ? { ...m.lastSpace } : null,
    log: m.log.slice(-8),
    mg:
      room.phase === 'minigame' && m.mgId
        ? {
            id: m.mgId,
            ...MINIGAMES[m.mgId],
            endsAt: room.phaseEndsAt,
            publicState: mgPublicState({ id: m.mgId, state: m.mgState }),
          }
        : room.phase === 'minigame_results' && m.mgId && m.mgResults
          ? {
              id: m.mgId,
              ...MINIGAMES[m.mgId],
              results: m.mgResults.map((r) => ({
                playerId: r.playerId,
                score: r.score,
                note: r.note,
                soulsDelta: r.soulsDelta,
              })),
            }
          : null,
    results:
      room.phase === 'results' && m.results
        ? {
            rows: m.results.rows.map((r) => ({
              playerId: r.playerId,
              souls: r.souls,
              status: r.status,
            })),
            winnerIds: [...m.results.winnerIds],
          }
        : null,
    now,
  }
}

/** Private chunk merged into playerView.me.matchPriv. */
export function matchPrivate(room, player, now = Date.now()) {
  const m = room.match
  if (!m) return null
  const mine = m.mp.get(player.id)
  const priv = {
    pos: mine.pos,
    souls: mine.souls,
    status: mine.status,
    items: [...mine.items],
    curses: [...mine.curses],
    isMyTurn: player.id === m.currentPlayerId && m.awaiting !== null,
    awaitingMe: player.id === m.currentPlayerId ? m.awaiting : null,
  }
  if (room.phase === 'minigame' && m.mgId) {
    priv.privateMg = privateMgView(m.mgId, m.mgState, player.id)
  }
  if (room.phase === 'results' && m.results) {
    const idx = m.results.rows.findIndex((r) => r.playerId === player.id)
    priv.rank = idx + 1
    priv.won = m.results.winnerIds.includes(player.id)
    priv.epilogue =
      priv.won
        ? 'You leave with more of yourself than you brought. The house hates that.'
        : priv.rank === 2
          ? 'So close the doorknob turned. It laughed.'
          : 'The house keeps what it counted. You may go.'
  }
  return priv
}

function privateMgView(mgId, state, playerId) {
  switch (MINIGAMES[mgId].kind) {
    case 'taps':
      return { myTaps: state.counts.get(playerId) ?? 0 }
    case 'lanes': {
      const r = state.racers.get(playerId)
      return r ? { stamina: Math.round(r.stamina), running: r.running, caughtAt: r.caughtAt } : {}
    }
    case 'secret_vote':
      return { voted: state.votes.has(playerId) }
    case 'grid':
      return { doneOrder: [...state.doneOrder] }
    default:
      return {}
  }
}
