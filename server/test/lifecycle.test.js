import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'

import { attachWhisperHub } from '../src/whisper/hub.js'

let server
let baseUrl
let hub
/** every socket this file opened, so after() can force-terminate them */
const clients = []

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}/whisper`)
    const client = { ws, inbox: [], waiters: [], cursor: 0, closed: false }
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
    ws.on('close', () => {
      client.closed = true
    })
    ws.on('open', () => resolve(client))
    ws.on('error', reject)
  })
}

/**
 * Await the next matching message in causal order (cursor-based, so batched
 * frames stay ordered and consumed messages never satisfy twice).
 */
function next(client, type, match, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.waiters = client.waiters.filter((w) => w.timer !== timer)
      reject(new Error(`timed out waiting for "${type}"`))
    }, timeoutMs)

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

before(async () => {
  const app = express()
  app.get('/health', (_req, res) => res.json({ status: 'ok', game: 'whisper' }))
  server = http.createServer(app)
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

test('tokens restore identities; stale sockets are superseded', async () => {
  // Fresh room for this file.
  const tv = await connect()
  send(tv, { t: 'tv_create' })
  const welcome = await next(tv, 'welcome')
  const code = welcome.code

  const ada = await connect()
  send(ada, { t: 'player_join', code, name: 'Ada' })
  const adaWelcome = await next(ada, 'welcome')
  await next(ada, 'room')

  const bram = await connect()
  send(bram, { t: 'player_join', code, name: 'Bram' })
  await next(bram, 'welcome')
  await next(bram, 'room')

  const cora = await connect()
  send(cora, { t: 'player_join', code, name: 'Cora' })
  await next(cora, 'welcome')
  await next(cora, 'room')

  // Start so direct joins are refused from here on.
  send(tv, { t: 'start', settings: { mode: 'ritual' } })
  await next(ada, 'event', (m) => m.kind === 'game_start')

  const latecomer = await connect()
  send(latecomer, { t: 'player_join', code, name: 'Nyx' })
  assert.equal((await next(latecomer, 'error')).code, 'game_in_progress')

  // Ada's phone dies and comes back with her token.
  ada.ws.close()
  await new Promise((r) => setTimeout(r, 120))
  const liveRoom = hub.rooms.get(code)
  assert.equal(
    liveRoom.players.find((p) => p.id === adaWelcome.you.id).connected,
    false
  )

  const reborn = await connect()
  send(reborn, {
    t: 'player_join',
    code,
    name: '',
    token: adaWelcome.token,
  })
  const rebornWelcome = await next(reborn, 'welcome')
  assert.equal(rebornWelcome.you.name, 'Ada')
  assert.equal(rebornWelcome.you.id, adaWelcome.you.id)
  const view = await next(reborn, 'room')
  assert.equal(view.view.phase, 'intro') // mid-game state restored

  // Unknown types are rejected politely.
  send(reborn, { t: 'summon_cthulhu' })
  assert.equal((await next(reborn, 'error')).code, 'unknown_type')

  // TV leaving eventually kills the room (grace period).
  tv.ws.close()
  bram.ws.close()
  cora.ws.close()
  reborn.ws.close()
  latecomer.ws.close()

  await new Promise((r) => setTimeout(r, 100))
  assert.ok(hub.rooms.has(code), 'room survives inside the grace window')
})

test('health endpoint reports ok', async () => {
  const res = await fetch(`${baseUrl.replace('ws', 'http')}/health`)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.status, 'ok')
})
