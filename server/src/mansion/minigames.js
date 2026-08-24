/**
 * MANSION — minigame runtime.
 *
 * Each entry in MINIGAME_RUNTIMES implements the same tiny contract:
 *   start(players, stage, now)  -> mutable state object
 *   input(state, playerId, data, now) -> {ok} | {error}
 *   tick(state, now) -> true if public-visible state changed (sync hint)
 *   finish(state)    -> rows [{playerId, score, note}] sorted best-first
 *
 * The engine (`engine.js`) owns timing, phases and reward application;
 * this module never touches rooms or sockets. Adding a minigame = adding
 * an entry here plus a registry entry in content.js.
 */

import { MINIGAMES } from './content.js'

const rnd = (n) => Math.floor(Math.random() * n)

/* ------------------------------------------------------------------ */
/* 1. KEEP THE CANDLE ALIVE — rapid taps                               */
/* ------------------------------------------------------------------ */

const candle = {
  start() {
    return { counts: new Map() }
  },
  input(state, playerId, data) {
    if (data?.type !== 'tap') return { error: 'bad_input' }
    // Rate guard: humanly impossible bursts are ignored.
    state.counts.set(playerId, Math.min((state.counts.get(playerId) ?? 0) + 1, 600))
    return { ok: true }
  },
  tick() {
    return false
  },
  finish(state) {
    const rows = [...state.counts.entries()].map(([playerId, n]) => ({
      playerId,
      score: n,
      note: `${n} taps`,
    }))
    rows.sort((a, b) => b.score - a.score)
    return rows
  },
}

/* ------------------------------------------------------------------ */
/* 2. ESCAPE THE MONSTER — hold-to-run endurance chase                 */
/* ------------------------------------------------------------------ */

export const CHASE_TUNING = {
  baseSpeed: 55, // units/s while walking
  runSpeed: 135, // units/s while holding RUN
  drainPerSec: 26,
  regenPerSec: 16,
  monsterSpeed: (stage) => 78 + stage * 18,
  monsterSurgeMult: 1.28, // after the surge moment the house gains ground
  surgeAtMs: 9000,
}

const chase = {
  start(players, stage, now) {
    return {
      t: now,
      startedAt: now,
      stage,
      monsterDist: -260,
      surged: false,
      racers: new Map(
        players.map((p) => [
          p.id,
          { dist: 0, running: false, stamina: 100, caughtAt: null },
        ])
      ),
      dirty: true,
    }
  },
  input(state, playerId, data) {
    const r = state.racers.get(playerId)
    if (!r || r.caughtAt) return { error: 'already_caught' }
    if (data?.type === 'run_on') r.running = true
    else if (data?.type === 'run_off') r.running = false
    else return { error: 'bad_input' }
    return { ok: true }
  },
  tick(state, now) {
    const dt = Math.min(1200, now - state.t) / 1000
    state.t = now
    if (!state.surged && now - state.startedAt >= CHASE_TUNING.surgeAtMs) {
      state.surged = true
    }
    let monsterSpeed =
      CHASE_TUNING.monsterSpeed(state.stage) * (state.surged ? CHASE_TUNING.monsterSurgeMult : 1)
    state.monsterDist += monsterSpeed * dt

    for (const r of state.racers.values()) {
      if (r.caughtAt) continue
      const running = r.running && r.stamina > 0
      r.dist += (running ? CHASE_TUNING.runSpeed : CHASE_TUNING.baseSpeed) * dt
      r.stamina = Math.max(
        0,
        Math.min(100, r.stamina + (running ? -CHASE_TUNING.drainPerSec : CHASE_TUNING.regenPerSec) * dt)
      )
      if (state.monsterDist >= r.dist) {
        r.caughtAt = now
        r.running = false
      }
    }
    return true
  },
  finish(state) {
    const rows = [...state.racers.entries()].map(([playerId, r]) => ({
      playerId,
      score: Math.floor(r.dist),
      note: r.caughtAt ? 'taken by it' : `${Math.floor(r.dist)} paces`,
      _key: r.caughtAt ? -r.caughtAt : r.dist + 1e9, // survivors first (by distance), then latest catches
    }))
    rows.sort((a, b) => b._key - a._key)
    for (const r of rows) delete r._key
    return rows
  },
}

/* ------------------------------------------------------------------ */
/* 3. DON'T LOOK — tap while dark, freeze when the eye opens           */
/* ------------------------------------------------------------------ */

const EYE_SAFE_MS = [2000, 3200]
const EYE_OPEN_MS = [1100, 1900]

function buildEyeSchedule(durationMs, now) {
  const windows = []
  let t = 1200 + rnd(800) // brief calm before the first blink
  let open = false
  while (t < durationMs - 400) {
    const span = open
      ? EYE_OPEN_MS[0] + rnd(EYE_OPEN_MS[1] - EYE_OPEN_MS[0])
      : EYE_SAFE_MS[0] + rnd(EYE_SAFE_MS[1] - EYE_SAFE_MS[0])
    const to = Math.min(t + span, durationMs)
    windows.push({ open, from: t, to })
    open = !open
    t = to
  }
  return windows.map((w) => ({ ...w, from: w.from + now, to: w.to + now }))
}

function eyeIsOpen(state, now) {
  for (const w of state.schedule) {
    if (w.open && now >= w.from && now < w.to) return true
  }
  return false
}

const dontlook = {
  start(players, stage, now) {
    const duration = MINIGAMES.dontlook.durationMs
    return {
      startedAt: now,
      schedule: buildEyeSchedule(duration, now),
      counts: new Map(players.map((p) => [p.id, 0])),
      stings: new Map(players.map((p) => [p.id, 0])),
      wasOpen: false,
      stage,
    }
  },
  input(state, playerId, data, now) {
    if (data?.type !== 'tap') return { error: 'bad_input' }
    if (eyeIsOpen(state, now)) {
      // It SAW you.
      state.stings.set(playerId, (state.stings.get(playerId) ?? 0) + 1)
    } else {
      state.counts.set(playerId, (state.counts.get(playerId) ?? 0) + 1)
    }
    return { ok: true }
  },
  tick(state, now) {
    const open = eyeIsOpen(state, now)
    if (open !== state.wasOpen) {
      state.wasOpen = open
      state.eyeNow = open
      state.eyeUntil = now
      return true
    }
    return false
  },
  finish(state) {
    const rows = [...state.counts.entries()].map(([playerId, n]) => {
      const stings = state.stings.get(playerId) ?? 0
      const score = Math.max(0, n - stings * 4)
      return { playerId, score, note: stings ? `${stings}× seen` : 'never seen' }
    })
    rows.sort((a, b) => b.score - a.score)
    return rows
  },
}

/* ------------------------------------------------------------------ */
/* 4. SACRIFICE — secret vote                                          */
/* ------------------------------------------------------------------ */

const sacrifice = {
  start(players) {
    return {
      votes: new Map(),
      eligible: players.map((p) => p.id),
      dirty: false,
    }
  },
  input(state, playerId, data) {
    if (data?.type !== 'vote') return { error: 'bad_input' }
    const targetId = String(data.targetId ?? '')
    if (!state.eligible.includes(targetId)) return { error: 'bad_target' }
    if (targetId === playerId) return { error: 'cannot_vote_self' }
    state.votes.set(playerId, targetId)
    state.dirty = true
    return { ok: true }
  },
  tick(state) {
    const dirty = state.dirty
    state.dirty = false
    return dirty
  },
  finish(state) {
    const tally = new Map()
    for (const target of state.votes.values()) {
      tally.set(target, (tally.get(target) ?? 0) + 1)
    }
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1])
    const chosen = sorted[0] && (!sorted[1] || sorted[1][1] < sorted[0][1]) ? sorted[0][0] : null

    return state.eligible.map((playerId) => {
      const myVote = state.votes.get(playerId)
      const votesReceived = tally.get(playerId) ?? 0
      if (chosen && myVote === chosen) {
        return { playerId, score: votesReceived, note: 'the altar accepted your offering', delta: +1 }
      }
      if (chosen === playerId) {
        return { playerId, score: votesReceived, note: 'chosen by the majority', delta: -2 }
      }
      return { playerId, score: votesReceived, note: chosen ? 'spared' : 'the altar refused a split table', delta: 0 }
    })
  },
}

/* ------------------------------------------------------------------ */
/* 5. HAUNTED MAZE — d-pad navigation of a seeded maze                 */
/* ------------------------------------------------------------------ */

export const MAZE_SIZE = 11 // odd; walls between cells via bitmask

/** Recursive-backtracker maze. cells[y*w+x] bit N=1 E=2 S=4 W=8 (open sides). */
export function buildMaze(w, h, seed) {
  let s = seed >>> 0 || 1
  const rand = () => {
    // xorshift32 — deterministic per seed so tests can replay boards.
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 0xffffffff
  }
  const cells = new Array(w * h).fill(0)
  const visited = new Array(w * h).fill(false)
  const idx = (x, y) => y * w + x
  const stack = [[0, 0]]
  visited[0] = true
  const DIRS = [
    [0, -1, 1, 4], // dx, dy, bit(here), bit(there)
    [1, 0, 2, 8],
    [0, 1, 4, 1],
    [-1, 0, 8, 2],
  ]
  while (stack.length) {
    const [x, y] = stack[stack.length - 1]
    const options = DIRS.filter(([dx, dy]) => {
      const nx = x + dx
      const ny = y + dy
      return nx >= 0 && ny >= 0 && nx < w && ny < h && !visited[idx(nx, ny)]
    })
    if (!options.length) {
      stack.pop()
      continue
    }
    const [dx, dy, bit, obit] = options[Math.floor(rand() * options.length)]
    const nx = x + dx
    const ny = y + dy
    cells[idx(x, y)] |= bit
    cells[idx(nx, ny)] |= obit
    visited[idx(nx, ny)] = true
    stack.push([nx, ny])
  }
  return cells
}

const maze = {
  start(players, stage, now) {
    const w = MAZE_SIZE
    const h = MAZE_SIZE
    const seed = (Math.random() * 0xffffffff) >>> 0
    const cells = buildMaze(w, h, seed)
    const exit = { x: w - 1, y: h - 1 }
    // Everyone enters near the opposite corner, fanned out.
    const starts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 1 },
      { x: 3, y: 0 },
      { x: 0, y: 3 },
    ]
    return {
      w,
      h,
      cells,
      exit,
      seed,
      stage,
      pos: new Map(players.map((p, i) => [p.id, { ...starts[i % starts.length] }])),
      doneOrder: [],
      startedAt: now,
    }
  },
  input(state, playerId, data) {
    if (data?.type !== 'move') return { error: 'bad_input' }
    const dirMap = { up: 1, right: 2, down: 4, left: 8 }
    const bit = dirMap[data.dir]
    if (!bit) return { error: 'bad_input' }
    const p = state.pos.get(playerId)
    if (!p || state.doneOrder.includes(playerId)) return { error: 'done_or_missing' }
    const cell = state.cells[p.y * state.w + p.x]
    if (!(cell & bit)) return { error: 'wall' }
    if (bit === 1) p.y -= 1
    if (bit === 2) p.x += 1
    if (bit === 4) p.y += 1
    if (bit === 8) p.x -= 1
    if (p.x === state.exit.x && p.y === state.exit.y && !state.doneOrder.includes(playerId)) {
      state.doneOrder.push(playerId)
    }
    return { ok: true }
  },
  tick() {
    return false
  },
  finish(state) {
    const manhattan = (p) =>
      Math.abs(p.x - state.exit.x) + Math.abs(p.y - state.exit.y)
    const rows = [...state.pos.entries()].map(([playerId, p]) => {
      const doneIdx = state.doneOrder.indexOf(playerId)
      return {
        playerId,
        score: doneIdx >= 0 ? 1000 - doneIdx : 500 - manhattan(p) * 10,
        note: doneIdx >= 0 ? `escaped #${doneIdx + 1}` : 'still lost inside',
        _k: doneIdx >= 0 ? 1000 - doneIdx : 500 - manhattan(p) * 10,
      }
    })
    rows.sort((a, b) => b._k - a._k)
    for (const r of rows) delete r._k
    return rows
  },
}

export const MINIGAME_RUNTIMES = {
  candle,
  chase,
  dontlook,
  sacrifice,
  maze,
}

/** Strip Maps/etc into JSON-safe public snapshots for the views. */
export function mgPublicState(mg) {
  const rt = MINIGAME_RUNTIMES[mg.id]
  switch (MINIGAMES[mg.id].kind) {
    case 'taps':
      return { counts: Object.fromEntries(mg.state.counts) }
    case 'lanes':
      return {
        monsterDist: Math.floor(mg.state.monsterDist),
        surged: mg.state.surged,
        racers: [...mg.state.racers.entries()].map(([id, r]) => ({
          id,
          dist: Math.floor(r.dist),
          stamina: Math.round(r.stamina),
          running: r.running,
          caughtAt: r.caughtAt,
        })),
      }
    case 'gated_taps':
      return {
        startedAt: mg.state.startedAt,
        schedule: mg.state.schedule,
        counts: Object.fromEntries(mg.state.counts),
        stings: Object.fromEntries(mg.state.stings),
        eyeOpen: eyeIsOpen(mg.state, Date.now()),
      }
    case 'secret_vote':
      return { votesCast: mg.state.votes.size, eligible: mg.state.eligible }
    case 'grid':
      return {
        w: mg.state.w,
        h: mg.state.h,
        cells: mg.state.cells,
        exit: mg.state.exit,
        pos: Object.fromEntries([...mg.state.pos].map(([id, p]) => [id, p])),
        doneOrder: [...mg.state.doneOrder],
      }
    default:
      return typeof rt?.public === 'function' ? rt.public(mg.state) : {}
  }
}
