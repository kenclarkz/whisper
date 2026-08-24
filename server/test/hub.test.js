import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

import { attachWhisperHub } from '../src/whisper/hub.js'

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

let server
let baseUrl
let hub
/** every socket this file opened, so after() can force-terminate them */
const clients = []

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/whisper`)
    const client = { ws, inbox: [], waiters: [], cursor: 0 }
    clients.push(client)
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw))
      const idx = client.inbox.length
      client.inbox.push(msg)
      for (const w of [...client.waiters]) {
        if (msg.t === w.type && (!w.match || w.match(msg))) {
          client.waiters = client.waiters.filter((x) => x !== w)
          client.cursor = Math.max(client.cursor, idx + 1)
          clearTimeout(w.timer)
          w.resolve(msg)
          break
        }
      }
    })
    ws.on('open', () => resolve(client))
    ws.on('error', reject)
  })
}

/**
 * Await the next matching message in causal order. A per-client cursor keeps
 * batched frames (welcome+room arrive in one socket tick) ordered one per
 * await while guaranteeing consumed messages never satisfy again.
 */
function next(client, type, match, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.waiters = client.waiters.filter((w) => w.timer !== timer)
      const recent = client.inbox.slice(-6).map((m) => m.t).join(',')
      reject(new Error(`timed out waiting for "${type}" (recent: ${recent || 'none'})`))
    }, timeoutMs)

    // Consume from the cursor forward — covers messages that already arrived.
    for (let i = client.cursor; i < client.inbox.length; i++) {
      const m = client.inbox[i]
      if (m.t === type && (!match || match(m))) {
        client.cursor = i + 1
        clearTimeout(timer)
        return resolve(m)
      }
    }

    client.waiters.push({ type, match, timer, resolve })
  })
}

const send = (client, payload) => client.ws.send(JSON.stringify(payload))
const latestRoom = (client) =>
  [...client.inbox].reverse().find((m) => m.t === 'room')?.view

before(async () => {
  server = http.createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  baseUrl = `ws://127.0.0.1:${port}`
  const wss = new WebSocketServer({ server, path: '/whisper' })
  hub = attachWhisperHub({ wss })
})

after(async () => {
  for (const c of clients) {
    try {
      c.ws.terminate()
    } catch {
      /* noop */
    }
  }
  await new Promise((r) => hub.wss.close(r))
  await new Promise((r) => server.close(r))
})

test('full seance: join → lobby → whispers → forge → vote → ending → again', async () => {
  /* --- TV opens the room ------------------------------------------- */
  const tv = await connect()
  send(tv, { t: 'tv_create' })
  const welcome = await next(tv, 'welcome')
  assert.equal(welcome.kind, 'tv')
  const code = welcome.code
  assert.match(code, /^[A-Z2-9]{4}$/)
  const lobbyMsg = await next(tv, 'room')
  assert.equal(lobbyMsg.view.phase, 'lobby')

  /* --- unknown codes refused --------------------------------------- */
  const stranger = await connect()
  send(stranger, { t: 'player_join', code: 'ZZZZ', name: 'Ghost' })
  assert.equal((await next(stranger, 'error')).code, 'unknown_room')
  stranger.ws.close()

  /* --- three players join ------------------------------------------- */
  const players = []
  for (const name of ['Ada', 'Bram', 'Cora']) {
    const p = await connect()
    send(p, { t: 'player_join', code, name })
    const w = await next(p, 'welcome')
    assert.equal(w.kind, 'player')
    assert.ok(w.token)
    await next(p, 'room')
    players.push(p)
  }
  const filled = await next(tv, 'room', (m) => m.view.players.length === 3)
  assert.deepEqual(
    filled.view.players.map((p) => p.name).sort(),
    ['Ada', 'Bram', 'Cora']
  )

  /* --- duplicate names refused -------------------------------------- */
  const dupe = await connect()
  send(dupe, { t: 'player_join', code, name: 'ada' })
  assert.equal((await next(dupe, 'error')).code, 'name_taken')
  dupe.ws.close()

  /* --- phones cannot start ------------------------------------------ */
  send(players[0], { t: 'start' })
  assert.equal((await next(players[0], 'error')).code, 'forbidden')

  /* --- start --------------------------------------------------------- */
  send(tv, { t: 'start' })
  await next(players[0], 'event', (m) => m.kind === 'game_start')
  const started = (await next(players[0], 'room')).view
  assert.equal(started.phase, 'intro')
  assert.ok(started.me.secret.length > 10)

  // Internal truth (server-side only): exactly one Whisperer.
  const liveRoom = hub.rooms.get(code)
  const whispererPlayer = liveRoom.players.find((p) => p.role === 'whisperer')
  assert.equal(liveRoom.players.filter((p) => p.role === 'innocent').length, 2)

  // Snapshots never reveal who it is during play.
  for (const p of players) {
    const view = latestRoom(p)
    assert.ok(view.players.every((pl) => !('role' in pl)))
  }

  /* --- intro → secrets → round 1 ------------------------------------- */
  send(tv, { t: 'advance' }) // intro -> secrets
  await next(players[0], 'room')
  send(tv, { t: 'advance' }) // secrets -> whisper round 1
  const roundStart = await next(players[0], 'event', (m) => m.kind === 'round_start')
  assert.equal(roundStart.round, 1)
  assert.equal(latestRoom(players[0]).phase, 'whisper')

  /* --- a whispered secret crosses the room --------------------------- */
  const senderId = latestRoom(players[0]).me.id
  const receiverId = latestRoom(players[1]).me.id

  send(players[0], { t: 'whisper_begin', toId: receiverId })
  send(players[0], { t: 'whisper_chunk', text: 'the well remembers your name,' })
  send(players[0], { t: 'whisper_chunk', text: ' Ada.' })
  send(players[0], { t: 'whisper_end' })

  const delivered = await next(
    players[1],
    'whisper_in',
    (m) => m.message.text.includes('well remembers')
  )
  assert.equal(delivered.message.text, 'the well remembers your name, Ada.')
  assert.equal(delivered.message.stolen, false)

  // The Whisperer steals a copy unless part of the exchange.
  if (whispererPlayer.id !== senderId && whispererPlayer.id !== receiverId) {
    const wSock = players.find((_, i) => latestRoom(players[i]).me.id === whispererPlayer.id)
    const stolen = await next(wSock, 'whisper_in', (m) => m.message.stolen === true)
    assert.equal(stolen.message.text, 'the well remembers your name, Ada.')
  }

  // The innocent outsider received nothing at all.
  const outsiderSock = players.find((p) => {
    const id = latestRoom(p).me.id
    return id !== senderId && id !== receiverId && id !== whispererPlayer.id
  })
  if (outsiderSock) {
    await new Promise((r) => setTimeout(r, 120))
    assert.equal(outsiderSock.inbox.some((m) => m.t === 'whisper_in'), false)
  }

  /* --- the forged tongue ---------------------------------------------- */
  const wSock = players.find((_, i) => latestRoom(players[i]).me.id === whispererPlayer.id)
  const forgeTarget = players.find((p) => p !== wSock)
  const forgeTargetId = latestRoom(forgeTarget).me.id

  send(wSock, { t: 'forge', toId: forgeTargetId, text: 'Cora saw what you buried.' })
  const forged = await next(forgeTarget, 'whisper_in', (m) =>
    m.message.text.startsWith('Cora saw')
  )
  // Disguised: never attributed to the Whisperer.
  assert.notEqual(forged.message.fromName, whispererPlayer.name)
  assert.equal(forged.message.stolen, false)

  // Once per round.
  send(wSock, { t: 'forge', toId: forgeTargetId, text: 'again!' })
  assert.equal((await next(wSock, 'error')).code, 'forge_used')

  /* --- ride the phases to judgement ------------------------------------ */
  send(tv, { t: 'advance' })
  const omen = await next(tv, 'event', (m) => m.kind === 'omen')
  assert.ok(omen.line.length > 5)
  assert.equal(latestRoom(tv).phase, 'omen')

  send(tv, { t: 'advance' })
  await next(tv, 'event', (m) => m.kind === 'round_start' && m.round === 2)
  send(tv, { t: 'advance' })
  await next(tv, 'event', (m) => m.kind === 'omen')
  send(tv, { t: 'advance' })
  await next(tv, 'event', (m) => m.kind === 'round_start' && m.round === 3)
  send(tv, { t: 'advance' })
  await next(tv, 'event', (m) => m.kind === 'vote_open')
  assert.equal(latestRoom(tv).phase, 'vote')

  /* --- ballots seal against the Whisperer ------------------------------- */
  for (const p of players) {
    send(p, { t: 'vote', targetId: whispererPlayer.id })
  }
  await next(tv, 'room', (m) => m.view.publicStats.votesCast === 3)

  send(tv, { t: 'advance' })
  const ending = await next(tv, 'event', (m) => m.kind === 'ending')
  assert.equal(ending.verdict, 'silence')

  const finalTv = (await next(tv, 'room', (m) => m.view.phase === 'ending')).view
  assert.equal(finalTv.outcome.verdict, 'silence')
  assert.ok(finalTv.reveal.some((r) => r.role === 'whisperer'))

  const finalPhoneView = players[0].inbox.findLast?.(
    (m) => m.t === 'room' && m.view.phase === 'ending'
  )
  const finalPhone =
    finalPhoneView?.view ??
    (await next(players[0], 'room', (m) => m.view.phase === 'ending')).view
  assert.ok(finalPhone.me.epilogue.length > 5)
  assert.equal(finalPhone.outcome.banishedName, whispererPlayer.name)

  /* --- play again -------------------------------------------------------- */
  send(tv, { t: 'play_again' })
  await next(tv, 'event', (m) => m.kind === 'back_to_lobby')
  assert.equal((await next(tv, 'room', (m) => m.view.phase === 'lobby')).view.phase, 'lobby')
  const phoneAfterReset = await next(players[0], 'room', (m) => m.view.phase === 'lobby')
  assert.equal(phoneAfterReset.view.me.role, null)

  tv.ws.close()
  for (const p of players) p.ws.close()
})
