'use client'

/**
 * TV minigame spectacle — full-screen presenters for each of the five
 * mansion games, driven entirely by public snapshots (mg.publicState).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Flame, Ghost, Skull } from 'lucide-react'
import type { MatchView, MgPublic } from '@/lib/whisper/protocol'
import { getAudio } from '@/lib/whisper/audio'
import { cn } from '@/lib/utils'
import { CountdownBar } from '../Atmosphere'

export function TvMinigame({
  mg,
  players,
  now,
}: {
  mg: MgPublic
  players: MatchView['players']
  now: number
}) {
  const kind = mg.id
  return (
    <main className="relative z-10 grid min-h-dvh place-items-center p-8">
      <div className="w-full max-w-5xl">
        <header className="mb-6 text-center">
          <h2 className="font-display text-4xl tracking-widest2 text-shadow-cine">{mg.name}</h2>
          <p className="mt-1 italic text-bone-dim">{mg.tagline}</p>
          {mg.endsAt ? (
            <div className="mx-auto mt-4 max-w-md">
              <CountdownBar endsAt={mg.endsAt} now={now} totalMs={mg.durationMs ?? 20000} />
            </div>
          ) : null}
        </header>

        {kind === 'candle' ? <CandlePresenter mg={mg} players={players} /> : null}
        {kind === 'chase' ? <ChasePresenter mg={mg} players={players} /> : null}
        {kind === 'dontlook' ? <DontLookPresenter mg={mg} players={players} /> : null}
        {kind === 'sacrifice' ? <SacrificePresenter mg={mg} players={players} /> : null}
        {kind === 'maze' ? <MazePresenter mg={mg} players={players} /> : null}

        <p className="mt-6 text-center text-xs uppercase tracking-widest2 text-bone-faint">
          {mg.controlsHint ?? 'play on your phone'}
        </p>
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------ */
/* Candle — tap frenzy                                                 */
/* ------------------------------------------------------------------ */

function CandlePresenter({ mg, players }: { mg: MgPublic; players: MatchView['players'] }) {
  const counts = (mg.publicState?.counts ?? {}) as Record<string, number>
  const max = Math.max(1, ...Object.values(counts))
  const sorted = [...players].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {sorted.map((p) => {
        const n = counts[p.id] ?? 0
        return (
          <div key={p.id} className="card-seal rounded-xl px-5 py-4 text-center">
            <Flame
              size={30 + (n / max) * 26}
              className={cn('mx-auto transition-all duration-300', n > 0 ? 'text-blood-bright animate-breathe' : 'text-bone-faint')}
            />
            <p className="mt-2 truncate font-display text-lg">{p.name}</p>
            <p className="font-display text-3xl tabular-nums text-hex-light">{n}</p>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Chase — hold to outrun                                              */
/* ------------------------------------------------------------------ */

function ChasePresenter({ mg, players }: { mg: MgPublic; players: MatchView['players'] }) {
  const ps = mg.publicState as {
    monsterDist: number
    surged: boolean
    racers: { id: string; dist: number; stamina: number; running: boolean; caughtAt: number | null }[]
  }
  const finish = Math.max(100, ...ps.racers.map((r) => r.dist), ps.monsterDist)
  return (
    <div className="space-y-4">
      {/* Monster progress */}
      <div className="relative h-12 rounded-xl border border-blood/50 bg-black/60 blood-pulse">
        <span
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-2xl transition-all duration-500"
          style={{ left: `${(ps.monsterDist / finish) * 100}%` }}
        >
          <Skull size={30} className={cn(ps.surged ? 'text-blood-bright animate-glitch' : 'text-blood')} />
        </span>
      </div>
      {ps.racers.map((r) => {
        const p = players.find((x) => x.id === r.id)
        return (
          <div key={r.id} className="relative h-14 rounded-xl bg-black/40 px-3">
            <span
              className="absolute top-1/2 -translate-y-1/2 z-10 transition-all duration-500"
              style={{ left: `calc(${Math.min(97, (r.dist / finish) * 100)}% )` }}
            >
              {r.caughtAt != null ? (
                <Ghost size={24} className="-translate-x-1/2 text-hex-light" />
              ) : (
                <span
                  className={cn(
                    'grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border font-display text-xs',
                    r.running ? 'border-moss bg-moss/25 text-bone' : 'border-bone-faint bg-black/70 text-bone-dim'
                  )}
                >
                  {p?.name.slice(0, 2).toUpperCase()}
                </span>
              )}
            </span>
            <div className="absolute bottom-1 left-3 right-3 flex items-center gap-2">
              <span className="w-20 truncate text-[0.65rem] uppercase tracking-wider text-bone-faint">
                {p?.name} {r.caughtAt != null ? '(caught)' : ''}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={cn('h-full rounded-full transition-all duration-300', r.stamina < 25 ? 'bg-blood-bright' : 'bg-moss')}
                  style={{ width: `${r.stamina}%` }}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Don't look — eyes open/shut                                         */
/* ------------------------------------------------------------------ */

function DontLookPresenter({ mg, players }: { mg: MgPublic; players: MatchView['players'] }) {
  const ps = mg.publicState as {
    eyeOpen: boolean
    counts: Record<string, number>
    stings: Record<string, number>
    schedule?: unknown
  }
  const prevEye = useRef(ps.eyeOpen)
  useEffect(() => {
    if (prevEye.current !== ps.eyeOpen) {
      prevEye.current = ps.eyeOpen
      getAudio().sting()
    }
  }, [ps.eyeOpen])

  return (
    <div className="flex flex-col items-center gap-8">
      <div
        className={cn(
          'grid h-36 w-full max-w-xl place-items-center rounded-2xl border transition-colors duration-300',
          ps.eyeOpen ? 'border-blood-bright bg-blood-dark/40' : 'border-bone-faint/40 bg-black/70'
        )}
      >
        {ps.eyeOpen ? (
          <Eye size={84} className="animate-breathe text-blood-bright" />
        ) : (
          <EyeOff size={72} className="text-bone-faint" />
        )}
        <p className={cn('mt-2 font-display tracking-widest2', ps.eyeOpen ? 'text-blood-bright' : 'text-bone-dim')}>
          {ps.eyeOpen ? 'THE PORTRAIT WATCHES' : 'eyes closed — TAP'}
        </p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-4 gap-3">
        {players.map((p) => (
          <div key={p.id} className="rounded-xl bg-black/50 px-3 py-2 text-center">
            <p className="truncate text-[0.7rem] uppercase tracking-wider text-bone-faint">{p.name}</p>
            <p className="font-display text-xl tabular-nums">{ps.counts[p.id] ?? 0}</p>
            {(ps.stings[p.id] ?? 0) > 0 ? (
              <p className="text-[0.65rem] tabular-nums text-blood-bright">✕{ps.stings[p.id]}</p>
            ) : (
              <p className="text-[0.65rem] text-bone-faint">&nbsp;</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sacrifice — secret vote                                             */
/* ------------------------------------------------------------------ */

function SacrificePresenter({ mg, players }: { mg: MgPublic; players: MatchView['players'] }) {
  const ps = mg.publicState as { votesCast: number; eligible: string[] }
  const total = Math.max(1, ps.eligible.length)
  return (
    <div className="mx-auto max-w-lg text-center">
      <Flame size={64} className="mx-auto mb-6 animate-breathe text-blood-bright" />
      <p className="font-display text-2xl leading-relaxed tracking-widest2">THE ALTAR LISTENS…</p>
      <p className="mt-2 italic text-bone-dim">Votes are sealed. Choose in secret.</p>
      <div className="mt-10 flex justify-center gap-2" aria-label="votes cast">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-3 w-8 rounded-full transition-colors',
              i < ps.votesCast ? 'bg-blood-bright shadow-[0_0_14px_rgba(224,52,44,0.7)]' : 'bg-white/[0.08]'
            )}
          />
        ))}
      </div>
      <p className="mt-4 text-sm tabular-nums text-bone-faint">
        {ps.votesCast}/{total} souls have spoken
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Maze — race to the exit                                             */
/* ------------------------------------------------------------------ */

const N = 1
const E = 2
const S = 4
const W = 8

function MazePresenter({ mg, players }: { mg: MgPublic; players: MatchView['players'] }) {
  const ps = mg.publicState as {
    w: number
    h: number
    cells: number[]
    exit: { x: number; y: number }
    pos: Record<string, { x: number; y: number }>
    doneOrder: string[]
  }

  const cellPx = useMemo(() => {
    // Fit an 11×11 maze into ~min(56vh) box.
    const box = typeof window === 'undefined' ? 520 : Math.min(window.innerHeight * 0.58, 560)
    return Math.floor(box / ps.w)
  }, [ps.w])

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="relative rounded-xl bg-black/60 p-2 ring-1 ring-bone-faint/25"
        style={{ width: ps.w * cellPx + 16 }}
      >
        {Array.from({ length: ps.h }, (_, y) => (
          <div key={y} className="flex">
            {Array.from({ length: ps.w }, (_, x) => {
              const c = ps.cells[y * ps.w + x]
              return (
                <div
                  key={x}
                  className="relative"
                  style={{
                    width: cellPx,
                    height: cellPx,
                    borderTop: c & N ? undefined : '2px solid rgba(232,224,208,0.35)',
                    borderRight: c & E ? undefined : '2px solid rgba(232,224,208,0.35)',
                    borderBottom: c & S ? undefined : '2px solid rgba(232,224,208,0.35)',
                    borderLeft: c & W ? undefined : '2px solid rgba(232,224,208,0.35)',
                    background:
                      ps.exit.x === x && ps.exit.y === y ? 'rgba(95,115,85,0.28)' : undefined,
                  }}
                />
              )
            })}
          </div>
        ))}
        {/* Tokens */}
        {Object.entries(ps.pos).map(([id, p], i) => {
          const pl = players.find((q) => q.id === id)
          const rank = ps.doneOrder.indexOf(id)
          return (
            <span
              key={id}
              className="absolute z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border font-display text-[0.6rem] transition-all duration-200"
              style={{
                left: 8 + p.x * cellPx,
                top: 8 + p.y * cellPx,
                borderColor: ['var(--tw-ring-offset-shadow)', '#E0342C', '#A79BC0', '#5F7355'][i % 4],
                background: rank >= 0 ? 'rgba(95,115,85,0.6)' : 'rgba(13,10,15,0.9)',
              }}
              title={pl?.name}
            >
              {pl?.name.slice(0, 1).toUpperCase()}
            </span>
          )
        })}
      </div>
      <p className="text-xs uppercase tracking-widest2 text-bone-faint">
        first to the moss-lit door wins · {ps.doneOrder.length} escaped
      </p>
    </div>
  )
}
