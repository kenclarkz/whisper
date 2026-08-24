'use client'

import { X } from 'lucide-react'
import type { WhisperInMsg } from '@/lib/whisper/protocol'
import { cn } from '@/lib/utils'

/**
 * The phone's private inbox — the ONLY place whisper text is ever shown.
 * `stolen` copies are intercepts only the Whisperer can see.
 */
export function WhisperInbox({
  inbox,
  onClose,
  isWhisperer,
}: {
  inbox: WhisperInMsg['message'][]
  onClose: () => void
  isWhisperer?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="safe-bottom w-full max-w-md rounded-t-3xl bg-[#120D16] p-5 ring-1 ring-bone-faint/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl tracking-wide text-bone">
            {isWhisperer ? 'Intercepts' : 'Whispers received'}
          </h2>
          <button aria-label="Close" onClick={onClose} className="text-bone-faint hover:text-bone">
            <X size={18} />
          </button>
        </div>

        {inbox.length === 0 ? (
          <p className="py-10 text-center text-sm italic text-bone-faint">
            Nothing yet. The dark is patient.
          </p>
        ) : (
          <ul className="max-h-[55dvh] space-y-3 overflow-y-auto pr-1">
            {[...inbox].reverse().map((m) => (
              <li key={m.id}>
                <div className="rounded-xl bg-black/40 p-3.5 ring-1 ring-bone-faint/10">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-xs font-medium tracking-wide text-hex-light">
                      {isWhisperer && m.stolen ? '(intercepted)' : m.fromName}
                    </span>
                    {m.stolen ? (
                      <span className="rounded-full border border-blood/60 px-2 py-0.5 text-[0.6rem] uppercase tracking-widest text-blood-bright">
                        stolen
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        'ml-auto text-[0.6rem] uppercase tracking-widest text-bone-faint'
                      )}
                    >
                      {new Date(m.at).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-[15px] leading-relaxed text-bone">{m.text}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-center text-[0.65rem] uppercase tracking-widest2 text-bone-faint/70">
          Spoken once, then gone
        </p>
      </div>
    </div>
  )
}
