import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { WebSocketServer } from 'ws'
import { attachWhisperHub } from './whisper/hub.js'
import { config } from './config.js'
import logger from './utils/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.disable('x-powered-by')

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', game: 'whisper', uptime: process.uptime() })
})

// Serve the exported web app (npm run build at the repo root produces ../out).
// One origin = phones and the TV talk to the same host, no CORS needed.
const staticDir = config.staticDir || path.resolve(__dirname, '../../out')
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir, { extensions: ['html'] }))
  logger.info(`serving static site from ${staticDir}`)
} else {
  logger.warn(
    `no static build found at ${staticDir} — run "npm run build" in the repo root`
  )
}

const server = http.createServer(app)

// The game socket. Clients connect to ws(s)://<host>/whisper
const wss = new WebSocketServer({ server, path: '/whisper' })
attachWhisperHub({ wss })

server.listen(config.port, () => {
  const ips = lanAddresses()
  logger.info(`WHISPER listening on http://0.0.0.0:${config.port}`)
  for (const ip of ips.slice(0, 4)) {
    logger.info(`  TV:   http://${ip}:${config.port}/tv/`)
    logger.info(`  join: http://${ip}:${config.port}/`)
  }
})

function lanAddresses() {
  const out = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address)
    }
  }
  return out
}

function shutdown(signal) {
  logger.info(`received ${signal}, shutting down`)
  wss.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
