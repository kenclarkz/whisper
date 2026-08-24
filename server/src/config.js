import 'dotenv/config'

function toNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const config = {
  port: toNumber(process.env.PORT, 8787),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  // Static export directory served at / (built with `npm run build`).
  staticDir: process.env.WHISPER_STATIC_DIR ?? '',

  // Rooms with no TV connection are destroyed after this grace period (ms).
  tvGraceMs: toNumber(process.env.WHISPER_TV_GRACE_MS, 60000),
}
