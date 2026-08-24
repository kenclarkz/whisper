'use client'

import type { WhisperGame } from '@/lib/whisper/useWhisper'

export function ErrorToast({ game }: { game: WhisperGame }) {
  if (!game.error) return null
  return (
    <button
      onClick={game.dismissError}
      className="fixed inset-x-4 bottom-6 z-50 rounded-xl bg-blood/25 p-3.5 text-left ring-1 ring-blood/60 backdrop-blur-md"
    >
      <p className="text-sm leading-snug text-bone">{game.error.message}</p>
      <p className="mt-1 text-[0.65rem] uppercase tracking-widest2 text-bone-faint">
        tap to dismiss
      </p>
    </button>
  )
}
