'use client'

/**
 * Persistent per-tab session so a phone that locks its screen (or briefly
 * loses signal) can reclaim its seat with the server-issued token.
 */

export interface WhisperSession {
  kind: 'tv' | 'player'
  code: string
  name: string
  playerId?: string
  token?: string
}

const KEY = 'whisper.session.v1'

export function loadSession(): WhisperSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as WhisperSession
    if (!parsed?.code || !parsed?.kind) return null
    return parsed
  } catch {
    return null
  }
}

export function saveSession(session: WhisperSession) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    /* storage unavailable */
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}
