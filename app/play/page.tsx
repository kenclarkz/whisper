'use client'

import { useEffect, useState } from 'react'
import { Ghost, RefreshCw } from 'lucide-react'
import { PhoneStage } from '@/components/PhoneStage'
import { JoinForm } from '@/components/JoinForm'
import { Atmosphere, ConnDot } from '@/components/Atmosphere'
import { ErrorToast } from '@/components/ErrorToast'
import { useWhisperGame } from '@/lib/whisper/useWhisper'
import { getAudio } from '@/lib/whisper/audio'

const CLOSED_COPY: Record<string, string> = {
  room_closed: 'The house has moved on. The ritual is over.',
  tv_lost: 'The television vanished. The house collapsed around it.',
  room_expired: 'The candles burned out. The mark is no more.',
  replaced: 'Another screen took this seat.',
}

export default function PlayPage() {
  const game = useWhisperGame()
  const [prefill, setPrefill] = useState<{ code: string; name: string } | null>(null)

  /* Prefill from ?code=&name= (static export: parse manually). */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const code = (q.get('code') ?? '').toUpperCase()
    const name = q.get('name') ?? ''
    if (code || name) setPrefill({ code, name })
  }, [])

  /* Phase stings. */
  useEffect(() => {
    if (!game.playerView) return
    switch (game.playerView.phase) {
      case 'secrets':
        getAudio().knock(1)
        break
      case 'whisper':
        getAudio().whoosh(0.5)
        break
      default:
        break
    }
  }, [game.playerView?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- states ---------------- */

  if (game.closedReason) {
    return (
      <Center>
        <Ghost className="mb-4 text-hex" size={40} />
        <p className="max-w-xs text-center font-display text-xl leading-relaxed">
          {CLOSED_COPY[game.closedReason] ?? 'The connection was severed.'}
        </p>
        <button onClick={() => window.location.replace('/')} className="wsp-btn-primary mt-8">
          <RefreshCw size={16} className="inline" /> Find another house
        </button>
      </Center>
    )
  }

  const seated =
    game.welcome?.kind === 'player' && game.playerView !== null

  if (seated && game.playerView) return <PhoneStage game={game} />

  /* Not seated yet: joining form or connecting spinner. */
  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 py-14">
      <Atmosphere />
      {game.connState === 'connecting' ? (
        <>
          <ConnDot state="connecting" />
          <p className="mt-4 animate-breathe text-sm uppercase tracking-widest2 text-bone-faint">
            KNOCKING…
          </p>
        </>
      ) : (
        <>
          <h1 className="mb-10 font-display text-3xl tracking-widest2">TAKE YOUR SEAT</h1>
          <JoinForm
            initialCode={prefill?.code ?? ''}
            initialName={prefill?.name ?? ''}
            onJoin={game.actions.join}
          />
          <ErrorToast game={game} />
        </>
      )}
    </main>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative z-10 grid min-h-dvh place-items-center px-6">
      <div className="flex flex-col items-center">{children}</div>
    </main>
  )
}
