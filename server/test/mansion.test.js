/**
 * MANSION board-party mode — engine, minigames and views.
 *
 * All tests run on a fake clock: `sweep()` advances time in TICK-sized
 * steps so idle auto-rolls, movement beats and phase deadlines fire
 * exactly like the hub ticker would in production.
 */

import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  createRoom,
  addPlayer,
  startGame,
} from '../src/whisper/state.js'
import {
  rollDice,
  useItem,
  haunt,
  mgInput,
  mansionTick,
  matchPublic,
  matchPrivate,
} from '../src/mansion/engine.js'
import { BOARD } from '../src/mansion/content.js'
import { buildMaze, MAZE_SIZE } from '../src/mansion/minigames.js'

const TICK = 500

function setupMansion(n, { laps = 1 } = {}) {
  const room = createRoom('TEST')
  const names = ['Ada', 'Bram', 'Cora', 'Dmitri', 'Edda', 'Felix', 'Greta', 'Hollis']
  const players = []
  for (let i = 0; i < n; i++) {
    const { player } = addPlayer(room, names[i])
    player.connected = true
    players.push(player)
  }
  const res = startGame(room, { mode: 'mansion', laps })
  assert.equal(res.error, undefined)
  return { room, players }
}

/** Advance the fake clock, ticking the engine like the hub would. */
function sweep(room, ms, start = Date.now()) {
  let t = start
  for (let elapsed = 0; elapsed < ms; elapsed += TICK) {
    t += TICK
    mansionTick(room, t)
    if (room.phase === 'results') break
  }
  return t
}

/** Tick until a phase/predicate hits (bounded). */
function sweepUntil(room, ms, predicate, start = Date.now()) {
  let t = start
  for (let elapsed = 0; elapsed < ms; elapsed += TICK) {
    t += TICK
    mansionTick(room, t)
    if (predicate(room)) return t
  }
  return t
}

/** Force-resolve a one-step movement onto pos+1 (bypasses dice). */
function stepOnto(room, fromPos, now) {
  const m = room.match
  const cur = m.currentPlayerId
  m.mp.get(cur).pos = fromPos
  m.awaiting = 'move'
  m.pendingMove = { playerId: cur, remaining: 1, nextAt: now + TICK, depth: 0 }
  mansionTick(room, now + TICK * 2)
}

describe('mansion setup', () => {
  it('builds a match with correct turn math and clean state', () => {
    const { room, players } = setupMansion(3, { laps: 2 })
    const m = room.match
    assert.equal(room.phase, 'board_intro')
    assert.equal(m.totalTurns, 6)
    assert.equal(m.order.length, 3)
    for (const p of players) {
      const mp = m.mp.get(p.id)
      assert.equal(mp.pos, 0)
      assert.equal(mp.souls, 0)
      assert.equal(mp.status, 'alive')
      assert.deepEqual(mp.items, [])
      assert.deepEqual(mp.curses, [])
    }
  })

  it('opens the board after the intro and seats the first player', () => {
    const { room } = setupMansion(2)
    sweep(room, 6000)
    assert.equal(room.phase, 'board')
    assert.ok(room.match.currentPlayerId)
    assert.equal(room.match.awaiting, 'roll')
    assert.ok(room.match.turnDeadline)
  })

  it('public view never leaks private internals', () => {
    const { room } = setupMansion(2)
    sweep(room, 6000)
    const pub = matchPublic(room)
    const json = JSON.stringify(pub)
    assert.ok(!json.includes('_events'))
    assert.ok(!json.includes('"mp"'))
    assert.ok(!json.includes('featherNext'))
  })
})

describe('mansion turns & movement', () => {
  it('auto-rolls for AFK players and completes the turn', () => {
    const { room } = setupMansion(2, { laps: 2 })
    let t = sweep(room, 6000)
    const first = room.match.currentPlayerId

    // Tick until the idle deadline fires and the house rolls for the seat.
    t = sweepUntil(
      room,
      60_000,
      (r) => r.match.awaiting === 'move' && r.match.lastRoll != null,
      t
    )
    assert.equal(room.match.awaiting, 'move')
    assert.ok(room.match.lastRoll)
    assert.equal(room.match.lastRoll.playerId, first)

    // Movement beats finish; the next seat begins (swept short on purpose
    // so the next player's idle window hasn't elapsed yet).
    t = sweep(room, 5_000, t)
    assert.equal(room.match.turnCount, 1)
    assert.notEqual(room.match.currentPlayerId, first)
    assert.equal(room.match.awaiting, 'roll')
  })

  it('refuses rolls out of turn or twice', () => {
    const { room, players } = setupMansion(2)
    sweep(room, 6000)
    const cur = room.match.currentPlayerId
    const other = players.find((p) => p.id !== cur)
    assert.equal(rollDice(room, other.id).error, 'not_your_turn')
    assert.equal(rollDice(room, cur).ok, true)
    assert.equal(rollDice(room, cur).error, 'already_rolled')
  })

  it('applies feather (≥4) and heavy boots (−1) to the roll', () => {
    const { room } = setupMansion(2)
    let t = sweep(room, 6000)
    const cur = room.match.currentPlayerId

    // Feather floor.
    room.match.mp.get(cur).items.push('black_feather')
    room.match.mp.get(cur).featherNext = true
    rollDice(room, cur, t)
    assert.ok(room.match.lastRoll.effective >= 4)

    // Wait out this move, then load heavy boots.
    t = sweep(room, 30_000, t)
    const cur2 = room.match.currentPlayerId
    room.match.mp.get(cur2).curses.push('heavy_boots')
    rollDice(room, cur2, t)
    const r = room.match.lastRoll
    assert.ok(!room.match.mp.get(cur2).curses.includes('heavy_boots'), 'curse consumed')
    assert.equal(r.effective, Math.max(1, r.value - 1))
  })

  it('soul spaces pay out and end the turn', () => {
    const { room } = setupMansion(2)
    let t = sweep(room, 6000)
    // Board[1] is a soul space; force one step onto it.
    stepOnto(room, 0, t)
    const cur = room.match.order[0]
    assert.equal(room.match.mp.get(cur).pos, 1)
    assert.equal(room.match.mp.get(cur).souls, 1)
    assert.equal(room.match.turnCount, 1)
  })

  it('safe rooms revive ghosts and clear curses', () => {
    const { room } = setupMansion(2)
    let t = sweep(room, 6000)
    const cur = room.match.currentPlayerId
    const mp = room.match.mp.get(cur)
    mp.status = 'ghost'
    mp.souls = 0
    mp.curses.push('marked')
    stepOnto(room, 10, t) // Board[11] = Chapel (safe)
    assert.equal(mp.status, 'alive')
    assert.ok(mp.souls >= 1)
    assert.deepEqual(mp.curses, [])
  })

  it('ghosts get a haunt offer over living prey and can steal a soul', () => {
    const { room, players } = setupMansion(2)
    let t = sweep(room, 6000)
    const ghost = room.match.currentPlayerId
    const prey = players.find((p) => p.id !== ghost).id
    const gm = room.match.mp.get(ghost)
    const pm = room.match.mp.get(prey)
    gm.status = 'ghost'

    // Prey waits on Board[1]; the ghost drifts onto them.
    pm.pos = 1
    pm.souls = 3
    stepOnto(room, 0, t)

    assert.equal(room.match.awaiting, 'haunt')
    assert.ok(room.match.haunt.deadline > t)

    const res = haunt(room, ghost, prey, t + 1000)
    assert.equal(res.error, undefined)
    assert.equal(pm.souls, 2)
    assert.equal(gm.souls, 1)
    assert.equal(room.match.turnCount, 1, 'haunt closes the turn')
  })

  it('spooked haunt curses a penniless target instead', () => {
    const { room, players } = setupMansion(2)
    let t = sweep(room, 6000)
    const ghost = room.match.currentPlayerId
    const prey = players.find((p) => p.id !== ghost).id
    room.match.mp.get(ghost).status = 'ghost'
    room.match.mp.get(prey).pos = 1
    room.match.mp.get(prey).souls = 0
    stepOnto(room, 0, t)
    const res = haunt(room, ghost, prey, t + 1000)
    assert.equal(res.error, undefined)
    assert.ok(room.match.mp.get(prey).curses.includes('heavy_boots'))
  })
})

describe('mansion items', () => {
  function atRollPhase(n = 2) {
    const ctx = setupMansion(n)
    ctx.t = sweep(ctx.room, 6000)
    return ctx
  }

  it('voodoo doll steals a soul, refunds itself on an empty mark', () => {
    const { room, players, t } = atRollPhase()
    const cur = room.match.currentPlayerId
    const other = players.find((p) => p.id !== cur)
    room.match.mp.get(cur).items.push('voodoo_doll')
    room.match.mp.get(other.id).souls = 2

    assert.equal(useItem(room, cur, 'voodoo_doll', other.id, t).ok, true)
    assert.equal(room.match.mp.get(other.id).souls, 1)
    assert.equal(room.match.mp.get(cur).souls, 1)
    assert.equal(room.match.mp.get(cur).items.length, 0)

    // Empty-handed victim → refund.
    sweep(room, 30_000, t)
    const cur2 = room.match.currentPlayerId
    const other2 = players.find((p) => p.id !== cur2).id
    room.match.mp.get(cur2).items.push('voodoo_doll')
    room.match.mp.get(other2).souls = 0
    assert.equal(useItem(room, cur2, 'voodoo_doll', other2, t).ok, true)
    assert.equal(room.match.mp.get(cur2).items.length, 1, 'doll refunded')
  })

  it('iron key walks its bearer to the nearest safe room', () => {
    const { room, players, t } = atRollPhase()
    const cur = room.match.currentPlayerId
    room.match.mp.get(cur).items.push('iron_key')
    room.match.mp.get(cur).pos = 9 // Long Hall → Chapel at 11 is nearest
    assert.equal(useItem(room, cur, 'iron_key', null, t).ok, true)
    assert.equal(room.match.mp.get(cur).pos, 11)
    assert.equal(BOARD[11].type, 'safe')
  })
})

describe('mansion minigames', () => {
  /** Jump to a candle minigame by loading the bag and finishing turn 4. */
  function reachCandle() {
    const { room, players } = setupMansion(2, { laps: 3 })
    let t = sweep(room, 6000)
    room.match.mgBag = ['candle']
    // Fast-forward three turns via forced single steps.
    for (let i = 0; i < 3; i++) {
      stepOnto(room, 4, t) // Board[5] curse space is harmless enough mid-test
      t += TICK
    }
    assert.equal(room.match.turnCount, 3)
    assert.equal(room.phase, 'board')
    // Finish turn 4 → minigame_intro.
    stepOnto(room, 4, Date.now())
    assert.equal(room.phase, 'minigame_intro')
    t = sweep(room, 6000, Date.now())
    assert.equal(room.phase, 'minigame')
    assert.equal(room.match.mgId, 'candle')
    return { room, players, t }
  }

  it('candle counts taps and pays rank rewards', () => {
    const { room, players, t: t0 } = reachCandle()
    const [a, b] = players.map((p) => p.id)
    // Neutralize curse noise from the forced approach turns so payouts are exact.
    for (const p of players) {
      const mp = room.match.mp.get(p.id)
      mp.curses = []
      mp.snuffedNext = false
    }
    mgInput(room, b, { type: 'tap' }, t0)
    for (let i = 0; i < 9; i++) mgInput(room, a, { type: 'tap' }, t0)

    const t = sweepUntil(
      room,
      20_000,
      (r) => r.phase === 'minigame_results',
      t0
    )
    assert.equal(room.phase, 'minigame_results')
    const rows = room.match.mgResults
    assert.equal(rows.length, 2)
    assert.equal(rows[0].playerId, a)
    assert.equal(rows[0].soulsDelta, 3, 'rank 1 reward')
    assert.equal(rows[1].soulsDelta, 2, 'rank 2 reward')

    sweep(room, 8000, t)
    assert.equal(room.phase, 'board', 'back to the board after results')
    assert.equal(room.match.mgId, null)
  })

  it('rejects input outside a running minigame', () => {
    const { room, players } = reachCandle()
    // Board phase between games refuses everything.
    const done = (() => {
      let tt = Date.now()
      tt = sweep(room, 40_000, tt)
      return room.phase === 'board'
    })()
    assert.ok(done)
    assert.equal(mgInput(room, players[0].id, { type: 'tap' }).error, 'no_minigame')
  })
})

describe('full mansion matches', () => {
  it('a two-player match reaches results with a winner', () => {
    const { room, players } = setupMansion(2, { laps: 2 })
    sweep(room, 10 * 60_000) // ten simulated minutes is plenty
    assert.equal(room.phase, 'results')
    const pub = matchPublic(room)
    assert.equal(pub.results.rows.length, 2)
    assert.ok(pub.results.winnerIds.length >= 1)
    const ids = new Set(players.map((p) => p.id))
    for (const w of pub.results.winnerIds) assert.ok(ids.has(w))

    // Personal slice carries rank + epilogue once dawn breaks.
    for (const p of players) {
      const priv = matchPrivate(room, p)
      assert.equal(typeof priv.rank, 'number')
      assert.equal(typeof priv.epilogue, 'string')
      assert.equal(priv.won, pub.results.winnerIds.includes(p.id))
    }
  })

  it('an eight-player match completes without stalling', () => {
    const { room } = setupMansion(8, { laps: 2 })
    sweep(room, 15 * 60_000)
    assert.equal(room.phase, 'results')
    const pub = matchPublic(room)
    assert.equal(pub.results.rows.length, 8)
    const top = pub.results.rows[0].souls
    assert.ok(pub.results.winnerIds.every((id) => pub.results.rows.find((r) => r.playerId === id)?.souls === top))
  })
})

describe('maze builder', () => {
  it('is deterministic per seed', () => {
    const a = buildMaze(MAZE_SIZE, MAZE_SIZE, 1234)
    const b = buildMaze(MAZE_SIZE, MAZE_SIZE, 1234)
    assert.deepEqual(a, b)
    assert.notDeepEqual(a, buildMaze(MAZE_SIZE, MAZE_SIZE, 99))
  })

  it('carves a perfect maze — every cell reachable', () => {
    const cells = buildMaze(MAZE_SIZE, MAZE_SIZE, 7)
    const w = MAZE_SIZE
    const seen = new Set([0])
    const stack = [0]
    const N = 1, E = 2, S = 4, W = 8
    while (stack.length) {
      const i = stack.pop()
      const x = i % w
      const y = Math.floor(i / w)
      const c = cells[i]
      if (c & N && y > 0 && !seen.has(i - w)) { seen.add(i - w); stack.push(i - w) }
      if (c & E && x < w - 1 && !seen.has(i + 1)) { seen.add(i + 1); stack.push(i + 1) }
      if (c & S && y < w - 1 && !seen.has(i + w)) { seen.add(i + w); stack.push(i + w) }
      if (c & W && x > 0 && !seen.has(i - 1)) { seen.add(i - 1); stack.push(i - 1) }
    }
    assert.equal(seen.size, w * w, 'every cell of the maze is connected')
  })
})
