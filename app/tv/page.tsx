'use client'

import { TvStage } from '@/components/TvStage'
import { Atmosphere } from '@/components/Atmosphere'
import { useWhisperGame } from '@/lib/whisper/useWhisper'
import { ConnDot } from '@/components/Atmosphere'

export default function TvPage() {
  const game = useWhisperGame()

  return (
    <div className="relative min-h-dvh">
      <Atmosphere motes={22} />
      {/* Connection chrome — unobtrusive, corner-pinned. */}
      <div className="fixed right-6 top-5 z-40 flex items-center gap-2 text-[0.65rem] uppercase tracking-widest2 text-bone-faint/70">
        {game.welcome?.code ?? '—'} <ConnDot state={game.connState} />
      </div>
      <TvStage game={game} />
    </div>
  )
}
