import { config } from '../config.js'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = LEVELS[config.logLevel] ?? LEVELS.info

function log(level, ...args) {
  if (LEVELS[level] < threshold) return
  const ts = new Date().toISOString()
  const prefix = `${ts} [${level.toUpperCase()}]`
  if (level === 'error' || level === 'warn') {
    console[level](prefix, ...args)
  } else {
    console.log(prefix, ...args)
  }
}

export default {
  debug: (...args) => log('debug', ...args),
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
}
