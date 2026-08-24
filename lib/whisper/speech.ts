'use client'

/**
 * Hold-to-talk dictation built on the Web Speech API (works in Android
 * Chrome and iOS Safari 14.5+). Every environment also gets a typed fallback,
 * so the game never hard-blocks on speech support.
 */

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
    length: number
  }>
}

function ctor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | SpeechRecognitionCtor
    | null
}

export function speechSupported(): boolean {
  return Boolean(ctor())
}

export interface DictationHandlers {
  onPartial?: (text: string) => void
  /** A finished phrase — send it to the server immediately. */
  onFinal?: (text: string) => void
  onError?: (code: string) => void
  onEnd?: () => void
}

/**
 * Live dictation session. Create one per press:
 *
 *   const d = startDictation({ onFinal, onPartial })
 *   …release…
 *   d.stop()
 */
export function startDictation(handlers: DictationHandlers): { stop: () => void } {
  const Ctor = ctor()
  if (!Ctor) {
    handlers.onError?.('unsupported')
    handlers.onEnd?.()
    return { stop: () => {} }
  }

  const rec = new Ctor()
  rec.lang = navigator.language || 'en-US'
  rec.continuous = true
  rec.interimResults = true
  rec.maxAlternatives = 1

  let stopped = false

  rec.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i]
      const text = res[0].transcript
      if (res.isFinal) {
        const clean = text.trim()
        if (clean) handlers.onFinal?.(clean)
      } else {
        handlers.onPartial?.(text)
      }
    }
  }

  rec.onerror = (ev) => {
    // 'no-speech' and 'aborted' are normal during hold/release; surface others.
    if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
      handlers.onError?.(ev.error)
    }
  }

  rec.onend = () => {
    if (!stopped) {
      // Chrome ends the session on silence — keep it alive while held.
      try {
        rec.start()
        return
      } catch {
        /* fall through */
      }
    }
    handlers.onEnd?.()
  }

  try {
    rec.start()
  } catch {
    handlers.onError?.('start_failed')
    handlers.onEnd?.()
  }

  return {
    stop() {
      stopped = true
      try {
        rec.stop()
      } catch {
        /* noop */
      }
      handlers.onEnd?.()
    },
  }
}
