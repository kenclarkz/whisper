'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Keyboard, SendHorizonal } from 'lucide-react'
import { speechSupported, startDictation, type DictationHandlers } from '@/lib/whisper/speech'
import { cn } from '@/lib/utils'

interface MicButtonProps {
  disabled?: boolean
  targetName?: string
  onBegin: () => void
  /** A finished spoken phrase — streamed to the server as a chunk. */
  onChunk: (text: string) => void
  /** Release (or send) — finalizes the whisper. */
  onEnd: () => void
  onCancel?: () => void
}

/**
 * Hold-to-whisper. Speech is transcribed on-device by the browser and the
 * finalized phrases are streamed to the server, which routes them ONLY to the
 * selected player. Falls back to typing anywhere.
 */
export function MicButton({ disabled, targetName, onBegin, onChunk, onEnd, onCancel }: MicButtonProps) {
  const [holding, setHolding] = useState(false)
  const [partial, setPartial] = useState('')
  const [typedMode, setTypedMode] = useState(false)
  const [typed, setTyped] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const dictationRef = useRef<{ stop: () => void } | null>(null)
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supportsSpeech = useRef(true)

  useEffect(() => {
    supportsSpeech.current = speechSupported()
    if (!supportsSpeech.current) setTypedMode(true)
    return () => {
      if (endTimerRef.current) clearTimeout(endTimerRef.current)
      dictationRef.current?.stop()
    }
  }, [])

  const finishHold = useCallback(() => {
    setHolding(false)
    setPartial('')
    dictationRef.current?.stop()
    dictationRef.current = null
    // Small grace so the recognizer can flush its trailing final phrase.
    if (endTimerRef.current) clearTimeout(endTimerRef.current)
    endTimerRef.current = setTimeout(() => {
      onEnd()
    }, 420)
  }, [onEnd])

  const press = useCallback(() => {
    if (disabled || holding) return
    setNotice(null)
    setHolding(true)
    navigator.vibrate?.(18)
    onBegin()

    if (!supportsSpeech.current) return
    const handlers: DictationHandlers = {
      onPartial: (text) => setPartial(text),
      onFinal: (text) => {
        setPartial('')
        onChunk(text)
      },
      onError: (code) => {
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setNotice('Microphone blocked — type instead below.')
          setTypedMode(true)
          finishHold()
        } else if (code === 'network') {
          setNotice('Speech service unreachable — your words still type.')
        }
      },
      onEnd: () => setPartial(''),
    }
    dictationRef.current = startDictation(handlers)
  }, [disabled, holding, onBegin, onChunk, finishHold])

  /* ---------------- typed fallback ---------------- */

  const sendTyped = useCallback(() => {
    const text = typed.trim()
    if (!text || disabled) return
    onBegin()
    onChunk(text)
    setTyped('')
    onEnd()
  }, [typed, disabled, onBegin, onChunk, onEnd])

  /* ---------------- render ---------------- */

  return (
    <div className="safe-pad fixed inset-x-0 bottom-0 z-50 bg-gradient-to-t from-void via-void/95 to-transparent pt-8">
      {/* live partial transcript */}
      <div className="mx-auto max-w-md px-4">
        {holding && partial ? (
          <p className="mb-2 rounded-lg bg-black/60 px-3 py-2 text-center text-sm italic text-bone-dim animate-pulse">
            “{partial}”
          </p>
        ) : null}
        {!holding && notice ? (
          <p className="mb-2 rounded-lg bg-blood-dark/40 px-3 py-2 text-center text-xs text-bone-dim">
            {notice}
          </p>
        ) : null}
      </div>

      {typedMode ? (
        <div className="mx-auto flex max-w-md items-end gap-2 px-4 pb-1">
          <textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value.slice(0, 400))}
            rows={2}
            placeholder={targetName ? `Whisper to ${targetName}…` : 'Choose someone first…'}
            className="wsp-input flex-1 resize-none py-3"
            enterKeyHint="send"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendTyped()
              }
            }}
          />
          <button
            aria-label="Send whisper"
            disabled={disabled || !typed.trim()}
            onClick={sendTyped}
            className="wsp-btn-primary grid h-[52px] w-[52px] place-items-center !rounded-full !px-0 disabled:opacity-40"
          >
            <SendHorizonal size={20} />
          </button>
        </div>
      ) : (
        <div className="flex justify-center pb-1">
          <button
            aria-label={holding ? 'Release to send whisper' : 'Hold to whisper'}
            disabled={disabled}
            className={cn(
              'relative grid h-24 w-24 touch-none select-none place-items-center rounded-full border transition-all duration-200',
              holding
                ? 'scale-105 border-blood-bright bg-blood/60 shadow-[0_0_50px_rgba(224,52,44,0.5)]'
                : 'border-blood/60 bg-blood-dark/30 shadow-[0_0_24px_rgba(163,22,33,0.25)]',
              disabled && 'opacity-35'
            )}
            onPointerDown={(e) => {
              e.preventDefault()
              press()
            }}
            onPointerUp={finishHold}
            onPointerCancel={finishHold}
            onPointerLeave={() => holding && finishHold()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {holding ? (
              <>
                <span className="absolute inset-0 animate-pulse-ring rounded-full border border-blood-bright" />
                <span className="absolute inset-0 animate-pulse-ring rounded-full border border-blood-bright [animation-delay:0.7s]" />
              </>
            ) : null}
            <Mic size={34} className={holding ? 'text-bone' : 'text-bone-dim'} />
          </button>
        </div>
      )}

      <div className="mt-2 pb-1 text-center">
        <button
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest2 text-bone-faint hover:text-bone-dim"
          onClick={() => {
            if (holding) finishHold()
            onCancel?.()
            setTypedMode((m) => !m)
          }}
        >
          <Keyboard size={13} />
          {typedMode ? 'hold to speak' : 'type instead'}
        </button>
      </div>
    </div>
  )
}
