'use client'

import { useState } from 'react'
import { Ghost, X } from 'lucide-react'
import type { PublicPlayer } from '@/lib/whisper/protocol'
import { cn } from '@/lib/utils'

/**
 * The Whisperer's forge — speak with a borrowed voice.
 * The message is delivered as if written by a random innocent;
 * only the sender knows it was forged.
 */
export function ForgeModal({
  targets,
  onClose,
  onSend,
}: {
  targets: PublicPlayer[]
  defaultTargetId?: string
  onClose: () => void
  onSend: (toId: string, text: string) => void
}) {
  const [toId, setToId] = useState<string>(targets[0]?.id ?? '')
  const [text, setText] = useState('')
  const ready = Boolean(toId) && text.trim().length >= 2

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card-seal safe-bottom w-full max-w-md rounded-t-3xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-xl text-blood-bright">
            <Ghost size={20} /> Borrowed voice
          </h2>
          <button aria-label="Close" onClick={onClose} className="text-bone-faint hover:text-bone">
            <X size={18} />
          </button>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-bone-dim">
          Your whisper arrives wearing someone else&apos;s lips. They will be blamed for what you
          say.
        </p>

        <p className="mb-1.5 text-[0.65rem] uppercase tracking-widest2 text-bone-faint">
          Wear this voice
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {targets.map((p) => (
            <button
              key={p.id}
              onClick={() => setToId(p.id)}
              disabled={!p.connected}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                toId === p.id
                  ? 'border-blood-bright bg-blood/20 text-bone'
                  : 'border-bone-faint/25 text-bone-dim'
              )}
            >
              {p.name}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 240))}
          rows={3}
          placeholder="Whisper something that damns them…"
          className="w-full resize-none rounded-xl bg-black/40 p-3 text-[15px] text-bone outline-none ring-1 ring-bone-faint/20 focus:ring-blood/60"
        />
        <div className="mt-1 mb-4 text-right text-[0.65rem] text-bone-faint">{text.length}/240</div>

        <div className="space-y-2">
          <button
            disabled={!ready}
            onClick={() => onSend(toId, text.trim())}
            className="wsp-btn-primary w-full !bg-gradient-to-b !from-blood !to-[#7a1710] disabled:opacity-40"
          >
            Release the forgery
          </button>
          <button onClick={onClose} className="wsp-btn-ghost w-full !py-3 text-xs">
            Not yet
          </button>
        </div>
      </div>
    </div>
  )
}
