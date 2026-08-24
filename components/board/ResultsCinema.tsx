'use client'

/**
 * Final reveal — crowns the mansion's richest soul(s) and shows everyone's
 * fate. Driven by match.results (rows + winnerIds).
 */

import { useEffect } from 'react'
import { Crown, Ghost, Skull, Sparkles } from 'lucide-react'
import type { MatchView } from '@/lib/whisper/protocol'
import { getAudio } from '@/lib/whisper/audio'
import { cn } from '@/lib/utils'

export function ResultsCinema({ match }: { match: MatchView }) {
  const rows = (match.results?.rows ?? [])
    .map((r) => ({
      ...r,
      name: match.players.find((p) => p.id === r.playerId)?.name ?? '???',
    }))
    .sort((a, b) => b.souls - a.souls)
  const winners = new Set(match.results?.winnerIds ?? [])
  const winnerNames = rows.filter((r) => winners.has(r.playerId)).map((r) => r.name)

  useEffect(() => {
    getAudio().sting()
  }, [])

  return (
    <main className="relative z-10 grid min-h-dvh place-items-center p-8">
      <div className="fog-layer fixed inset-0 z-0 fog-stage-2" aria-hidden />
      <div className="w-full max-w-3xl text-center">
        <Skull size={44} className="mx-auto animate-breathe text-blood-bright" />
        <p className="mt-6 text-[0.65rem] uppercase tracking-widest3 text-bone-faint">
          dawn breaks over the mansion
        </p>

        {winnerNames.length > 0 ? (
          <h1 className="glitch-in mt-4 font-display text-5xl leading-tight tracking-widest2 text-shadow-cine">
            {winnerNames.join(' & ')}
            <span className="mt-2 block text-xl text-bone-dim">
              {winnerNames.length > 1 ? 'leave with the souls' : 'leaves with the souls'}
            </span>
          </h1>
        ) : (
          <h1 className="mt-4 font-display text-4xl tracking-widest2">
            THE HOUSE KEEPS EVERYTHING
          </h1>
        )}

        <ul className="card-seal mx-auto mt-10 space-y-2 rounded-2xl p-5 text-left">
          {rows.map((r, i) => {
            const isWinner = winners.has(r.playerId)
            return (
              <li
                key={r.playerId}
                className={cn(
                  'flex items-center gap-4 rounded-xl px-4 py-3',
                  isWinner ? 'bg-blood-dark/40 ring-1 ring-blood-bright/60' : 'bg-black/45'
                )}
              >
                <span className="w-6 font-display text-bone-faint">{i + 1}</span>
                {r.status === 'ghost' ? (
                  <Ghost size={20} className="text-hex-light" />
                ) : isWinner ? (
                  <Crown size={20} className="text-blood-bright" />
                ) : (
                  <Sparkles size={18} className="text-bone-faint" />
                )}
                <span className="min-w-0 flex-1 truncate font-display text-lg">{r.name}</span>
                <span className="text-[0.7rem] uppercase tracking-wider text-bone-faint">
                  {r.status === 'ghost' ? 'taken by the house' : r.souls === 0 ? 'escaped empty-handed' : 'escaped'}
                </span>
                <span className={cn('font-display text-2xl tabular-nums', isWinner ? 'text-blood-bright' : '')}>
                  ✦{r.souls}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </main>
  )
}
