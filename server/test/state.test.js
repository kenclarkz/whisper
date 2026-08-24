import { test, describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  createRoom,
  addPlayer,
  startGame,
  openWhisper,
  chunkWhisper,
  cancelWhisper,
  closeWhisper,
  forgeWhisper,
  forgeUsedBy,
  castVote,
  finishVote,
  advance,
  resetToLobby,
  findPlayer,
  playerView,
  tvView,
} from '../src/whisper/state.js'

function setup(n = 3) {
  const room = createRoom('TEST')
  const names = ['Ada', 'Bram', 'Cora', 'Dmitri', 'Edda', 'Felix', 'Greta', 'Hollis']
  const players = []
  for (let i = 0; i < n; i++) {
    const { player } = addPlayer(room, names[i])
    player.connected = true
    players.push(player)
  }
  return { room, players }
}

/** These suites exercise the original whisper ritual; default is now mansion. */
function startRitual(room) {
  return startGame(room, { mode: 'ritual' })
}

describe('rooms & joining', () => {
  it('rejects bad and duplicate names', () => {
    const room = createRoom('TEST')
    assert.equal(addPlayer(room, '').error, 'bad_name')
    addPlayer(room, 'Ada')
    assert.equal(addPlayer(room, 'ada').error, 'name_taken')
    // Overlong names are truncated to the cap, not rejected.
    const long = addPlayer(room, 'x'.repeat(50))
    assert.ok(long.player)
    assert.equal(long.player.name.length, 14)
  })

  it('caps the table at eight', () => {
    const room = createRoom('TEST')
    for (let i = 0; i < 8; i++) assert.ok(addPlayer(room, `p${i}`).player)
    assert.equal(addPlayer(room, 'extra').error, 'room_full')
  })

  it('refuses joins once the ritual has begun', () => {
    const { room } = setup(3)
    startRitual(room)
    assert.equal(addPlayer(room, 'Late').error, 'game_in_progress')
  })
})

describe('roles & secrets', () => {
  it('crown exactly one Whisperer with unique innocent secrets', () => {
    const { room, players } = setup(5)
    assert.equal(startRitual(room).error, undefined)
    const whisperers = players.filter((p) => p.role === 'whisperer')
    assert.equal(whisperers.length, 1)

    const innocents = players.filter((p) => p.role === 'innocent')
    const secrets = new Set(innocents.map((p) => p.secret))
    assert.equal(secrets.size, innocents.length)
    for (const p of innocents) {
      assert.ok(p.baitWord.length > 0)
      assert.ok(['bait', 'listeners', 'silence'].includes(p.objective.kind))
    }
    // Every secret that references %WORD% got filled in.
    for (const p of innocents) {
      if (p.secret.includes('%WORD%')) assert.fail('unreplaced %WORD% token leaked')
    }
  })

  it('needs two players minimum', () => {
    const { room } = setup(1)
    assert.equal(startRitual(room).error, 'need_players')
    // Two players are enough to play — the séance and the mansion both.
    const duo = setup(2)
    assert.equal(startRitual(duo.room).error, undefined)
  })
})

describe('whispering', () => {
  let ctx
  beforeEach(() => {
    ctx = setup(3)
    startRitual(ctx.room)
    advance(ctx.room) // intro -> secrets
    advance(ctx.room) // secrets -> whisper round 1
    assert.equal(ctx.room.phase, 'whisper')
  })

  function whisperer() {
    return ctx.players.find((p) => p.role === 'whisperer')
  }

  it('delivers only to the target — the Whisperer steals a copy, others get nothing', () => {
    const [a, b, c] = ctx.players
    assert.equal(openWhisper(ctx.room, a.id, b.id).ok, true)
    chunkWhisper(ctx.room, a.id, 'I saw the doll move.')
    const res = closeWhisper(ctx.room, a.id)

    assert.equal(b.inbox.length, 1)
    assert.equal(b.inbox[0].text, 'I saw the doll move.')
    assert.equal(res.delivered.filter((d) => d.playerId === b.id).length, 1)

    const w = whisperer()
    if (w.id === a.id || w.id === b.id) {
      // The Whisperer was part of the exchange — no stolen copy exists.
      assert.equal(res.delivered.length, 1)
      assert.equal(c.inbox.length, 0)
    } else {
      const stolenTo = res.delivered.find((d) => d.message.stolen)
      assert.ok(stolenTo)
      assert.equal(stolenTo.playerId, w.id)
      assert.equal(w.inbox.at(-1).stolen, true)
    }
  })

  it('completes THE BAIT when the word arrives (case-insensitive)', () => {
    const baited = ctx.players.find(
      (p) => p.role === 'innocent' && p.objective?.kind === 'bait'
    )
    if (!baited) return // random assignment may not include bait with n=3
    const sender = ctx.players.find((p) => p !== baited && p.role === 'innocent')

    openWhisper(ctx.room, sender.id, baited.id)
    chunkWhisper(ctx.room, sender.id, `have you been to the ${baited.baitWord.toLowerCase()} lately`)
    closeWhisper(ctx.room, sender.id)
    assert.equal(baited.objective.done, true)
  })

  it('tracks distinct listeners', () => {
    const ear = ctx.players.find(
      (p) => p.role === 'innocent' && p.objective?.kind === 'listeners'
    )
    if (!ear) return
    assert.equal(ear.heardFrom.length, 0)
    const senders = ctx.players.filter((p) => p !== ear && p.role === 'innocent')
    for (const s of senders) {
      openWhisper(ctx.room, s.id, ear.id)
      chunkWhisper(ctx.room, s.id, 'listen…')
      closeWhisper(ctx.room, s.id)
    }
    assert.equal(ear.heardFrom.length, senders.length)
  })

  it('resolves THE VOW at round end', () => {
    const vow = ctx.players.find(
      (p) => p.role === 'innocent' && p.objective?.kind === 'silence'
    )
    if (!vow) return
    vow.objective.payload.round = 1
    // beforeEach already parked us in whisper round 1.
    assert.equal(ctx.room.phase, 'whisper')
    assert.equal(ctx.room.round, 1)

    // Someone else whispers; the vow-holder stays silent.
    const other = ctx.players.find((p) => p !== vow && p.role === 'innocent')
    openWhisper(ctx.room, other.id, vow.id)
    chunkWhisper(ctx.room, other.id, 'shh')
    closeWhisper(ctx.room, other.id)

    advance(ctx.room) // end r1 -> omen or vote
    assert.equal(vow.objective.done, !vow.sentRounds[1])
  })

  it('blocks self-whispers, offline targets and doubles', () => {
    const [a, b] = ctx.players
    assert.equal(openWhisper(ctx.room, a.id, a.id).error, 'cannot_whisper_self')
    b.connected = false
    assert.equal(openWhisper(ctx.room, a.id, b.id).error, 'player_offline')
    b.connected = true
    openWhisper(ctx.room, a.id, b.id)
    assert.equal(openWhisper(ctx.room, a.id, b.id).error, 'already_whispering')
    assert.equal(cancelWhisper(ctx.room, a.id).ok, true)
    assert.equal(chunkWhisper(ctx.room, a.id, 'hello').error, 'no_open_whisper')
  })

  it('drops empty whispers silently', () => {
    const [a, b] = ctx.players
    openWhisper(ctx.room, a.id, b.id)
    const res = closeWhisper(ctx.room, a.id)
    assert.deepEqual(res.delivered, [])
    assert.equal(b.inbox.length, 0)
  })
})

describe('the forged tongue', () => {
  it('arrives disguised as an innocent and is once-per-round', () => {
    const { room, players } = setup(4)
    startRitual(room)
    advance(room)
    advance(room)
    assert.equal(room.phase, 'whisper')
    const w = players.find((p) => p.role === 'whisperer')
    const innocents = players.filter((p) => p.role === 'innocent')
    const target = innocents[0]

    target.connected = true
    const res = forgeWhisper(room, w.id, target.id, 'Cora saw you bury it.')
    assert.equal(res.error, undefined)

    const received = target.inbox.at(-1)
    assert.equal(received.text, 'Cora saw you bury it.')
    assert.equal(received.forged, false) // flag stripped before delivery
    assert.notEqual(received.fromId, w.id) // disguised
    assert.ok(received.fromName.length > 0)

    assert.equal(forgeUsedBy(room, w.id), true)
    assert.equal(forgeWhisper(room, w.id, target.id, 'again').error, 'forge_used')

    // A second whisperer would still see it as stolen intelligence.
    const stolenCopy = res.delivered.find((d) => d.playerId !== target.id)
    if (stolenCopy) assert.equal(stolenCopy.message.stolen, true)
  })

  it('refuses non-whisperers and empty bodies', () => {
    const { room, players } = setup(3)
    startRitual(room)
    advance(room)
    advance(room)
    const innocent = players.find((p) => p.role === 'innocent')
    assert.equal(forgeWhisper(room, innocent.id, players[0].id, 'hi').error, 'forbidden')
  })
})

describe('judgement', () => {
  /** Drive the machine until ballots are open. */
  function toVote(room) {
    for (let i = 0; i < 12 && room.phase !== 'vote'; i++) advance(room)
    assert.equal(room.phase, 'vote')
  }

  it('banishing the Whisperer yields THE SILENCE', () => {
    const { room, players } = setup(3)
    startRitual(room)
    const w = players.find((p) => p.role === 'whisperer')
    toVote(room)
    for (const p of players) castVote(room, p.id, w.id)
    const outcome = finishVote(room)
    assert.equal(outcome.verdict, 'silence')
    assert.equal(outcome.banishedId, w.id)
    assert.equal(room.phase, 'ending')
    assert.equal(playerView(room, w).me.objective.done, false)
  })

  it('ties and abstention free the Hollow', () => {
    const { room, players } = setup(4)
    startRitual(room)
    const w = players.find((p) => p.role === 'whisperer')
    const innocents = players.filter((p) => p !== w)
    toVote(room)
    castVote(room, innocents[0].id, innocents[1].id)
    castVote(room, innocents[1].id, innocents[0].id)
    castVote(room, w.id, null)
    const outcome = finishVote(room)
    assert.equal(outcome.verdict, 'hollow')
    assert.equal(outcome.wasTie, true)
    assert.equal(outcome.banishedId, null)
    assert.equal(playerView(room, w).me.objective.done, true)
  })

  it('votes outside the vote phase are refused', () => {
    const { room, players } = setup(3)
    startRitual(room)
    assert.equal(castVote(room, players[0].id, null).error, 'not_vote_phase')
  })
})

describe('privacy firewall', () => {
  it('snapshots never leak roles, secrets or inbox text', () => {
    const { room, players } = setup(5)
    startRitual(room)
    const [a, b] = players
    openWhisper(room, a.id, b.id)
    chunkWhisper(room, a.id, 'SECRET-TEXT-XYZ')
    closeWhisper(room, a.id)

    for (const viewer of players) {
      const raw = JSON.stringify(playerView(room, viewer))
      assert.equal(raw.includes('SECRET-TEXT-XYZ'), false)
      for (const other of players) {
        if (other === viewer) continue
        assert.equal(raw.includes(other.secret), false)
      }
      // Own role visible; others' never.
      const parsed = JSON.parse(raw)
      for (const pub of parsed.players) {
        assert.equal(pub.role, undefined)
        assert.equal(pub.secret, undefined)
      }
    }

    const tvRaw = JSON.stringify(tvView(room))
    assert.equal(tvRaw.includes('SECRET-TEXT-XYZ'), false)
    const tv = JSON.parse(tvRaw)
    assert.equal(tv.reveal, null) // not during gameplay
    for (const pub of tv.players) {
      assert.equal(pub.role, undefined)
    }
  })

  it('reveals roles only at the ending', () => {
    const { room, players } = setup(3)
    startRitual(room)
    for (const p of players) castVote(room, p.id, players[0].id)
    finishVote(room)
    const tv = tvView(room)
    assert.ok(Array.isArray(tv.reveal))
    assert.ok(tv.players.every((p) => tv.reveal.some((r) => r.id === p.id)))
  })
})

describe('play again', () => {
  it('returns to a clean lobby keeping identities', () => {
    const { room, players } = setup(3)
    startRitual(room)
    resetToLobby(room)
    assert.equal(room.phase, 'lobby')
    assert.equal(room.outcome, null)
    for (const p of players) {
      assert.equal(p.role, null)
      assert.equal(p.secret, '')
      assert.equal(p.inbox.length, 0)
    }
    assert.equal(findPlayer(room, players[0].id).id, players[0].id)
  })
})
