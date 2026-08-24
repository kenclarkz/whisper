'use client'

/**
 * TV board — the cinematic haunted-mansion game board.
 *
 * Renders the 28-space perimeter, animated player tokens, turn/dice HUD,
 * standings rail, event log, mansion-stage atmosphere and camera zooms.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Crown, Dices, Ghost, Skull } from 'lucide-react'
import type { WhisperGame } from '@/lib/whisper/useWhisper'
import type { MatchView, SpaceType, TvView } from '@/lib/whisper/protocol'
import { getAudio } from '@/lib/whisper/audio'
import { BOARD_SIZE, percentForIndex, SPACE_TYPE_META } from '@/data/mansion'
import { cn } from '@/lib/utils'
import { ErrorToast } from '../ErrorToast'

export function MansionBoard({ tv, game }: { tv: TvView; game: WhisperGame }) {
  const match = tv.match
  if (!match) return null
  return (
    <main className="relative z-10 flex min-h-dvh flex-col p-6 pb-20">
      <StageAtmosphere stage={match.stage} />
      <BoardHeader match={match} />
      <div className="flex min-h-0 flex-1 gap-5">
        <BoardSpace match={match} />
        <StandingsRail match={match} />
      </div>
      <EventTicker match={match} />
      <MinigameSoonBanner phase={tv.phase} />
      {/* Overlays that ride on top of the board */}
      {tv.phase === 'board_intro' ? <BoardIntroCinematic /> : null}
      {(tv.phase === 'minigame_results' || (match.mg?.results?.length ?? 0) > 0) && match.mg ? (
        <MinigameResultsOverlay mg={match.mg} players={match.players} />
      ) : null}
      <ErrorToast game={game} />
    </main>
  )
}

/* ------------------------------------------------------------------ */
/* Atmosphere & header                                                 */
/* ------------------------------------------------------------------ */

function StageAtmosphere({ stage }: { stage: number }) {
  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-[3000ms]"
        style={{
          background:
            stage === 2
              ? 'radial-gradient(ellipse at 50% 30%, rgba(163,22,33,0.16), transparent 65%)'
              : stage === 1
                ? 'radial-gradient(ellipse at 50% 30%, rgba(122,106,143,0.12), transparent 60%)'
                : 'radial-gradient(ellipse at 50% 30%, rgba(21,16,25,0.4), transparent 70%)',
        }}
      />
      <div className={cn('fog-layer fixed inset-0 z-0', `fog-stage-${stage}`)} aria-hidden />
    </>
  )
}

function BoardHeader({ match }: { match: MatchView }) {
  const current = match.players.find((p) => p.id === match.currentPlayerId)
  const progress =
    match.totalTurns > 0
      ? Math.min(100, (match.turnCount / match.totalTurns) * 100)
      : 0

  return (
    <header className="mb-4 flex items-center justify-between gap-6">
      <div>
        <p className="text-[0.65rem] uppercase tracking-widest3 text-bone-faint">
          Night in the Mansion · Turn {Math.min(match.turnCount + 1, match.totalTurns)}/{match.totalTurns}
        </p>
        <h2 className="font-display text-2xl tracking-widest2">
          {current ? (
            <span className={cn(current.status === 'ghost' ? 'text-hex-light' : 'text-blood-bright')}>
              {current.name}&apos;s move
            </span>
          ) : (
            'The house stirs…'
          )}
        </h2>
      </div>

      <div className="flex items-center gap-8">
        <DicePanel match={match} />
        <div className="w-56">
          <p className="mb-1 text-right text-[0.6rem] uppercase tracking-widest2 text-bone-faint">
            The house is {match.stageName}
          </p>
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-hex to-blood transition-all duration-1000"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </header>
  )
}

function DicePanel({ match }: { match: MatchView }) {
  const [display, setDisplay] = useState<number | null>(null)
  const [tumbling, setTumbling] = useState(false)
  const lastKey = useRef('')

  useEffect(() => {
    const key = `${match.lastRoll?.playerId}-${match.lastRoll?.value}`
    if (!match.lastRoll || key === lastKey.current) return
    lastKey.current = key
    setTumbling(true)
    const iv = setInterval(() => setDisplay(1 + Math.floor(Math.random() * 6)), 80)
    const stop = setTimeout(() => {
      clearInterval(iv)
      setDisplay(match.lastRoll!.effective)
      setTumbling(false)
    }, 700)
    getAudio().knock(2)
    return () => {
      clearInterval(iv)
      clearTimeout(stop)
    }
  }, [match.lastRoll])

  return (
    <div className="flex items-center gap-3" aria-label="dice">
      <Dices size={26} className="text-bone-dim" />
      <span
        className={cn(
          'grid h-14 w-14 place-items-center rounded-xl border border-bone-faint/40 bg-black/50 font-display text-3xl',
          tumbling && 'dice-tumble border-blood-bright text-blood-bright'
        )}
      >
        {display ?? '–'}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The board itself                                                    */
/* ------------------------------------------------------------------ */

/** Server order of space types — must mirror server/src/mansion/content.js BOARD. */
const SPACE_TYPES: SpaceType[] = [
  'start', 'soul', 'item', 'mystery', 'shortcut', 'curse', 'soul', 'horror',
  'item', 'soul', 'mystery', 'safe', 'curse', 'soul', 'shortcut', 'item',
  'horror', 'soul', 'mystery', 'curse', 'soul', 'horror', 'soul', 'item',
  'mystery', 'safe', 'curse', 'horror',
]

function BoardSpace({ match }: { match: MatchView }) {
  const zoomTarget = useZoomTarget(match)

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl ring-1 ring-bone-faint/15">
      <div
        className="absolute inset-0 transition-transform duration-[1400ms] ease-out"
        style={{
          transformOrigin: zoomTarget ? `${zoomTarget.x}% ${zoomTarget.y}%` : '50% 50%',
          transform: zoomTarget ? 'scale(1.28)' : 'scale(1)',
        }}
      >
        {/* Rooms grid backdrop */}
        <div
          className="absolute inset-0 opacity-[0.13]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(232,224,208,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(232,224,208,0.14) 1px, transparent 1px)',
            backgroundSize: `${100 / 9}% ${100 / 7}%`,
          }}
        />

        {/* Path connections */}
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          {Array.from({ length: BOARD_SIZE }, (_, i) => {
            const a = percentForIndex(i)
            const b = percentForIndex((i + 1) % BOARD_SIZE)
            return (
              <line
                key={i}
                x1={`${a.x}%`}
                y1={`${a.y}%`}
                x2={`${b.x}%`}
                y2={`${b.y}%`}
                stroke="rgba(232,224,208,0.12)"
                strokeWidth="2"
                strokeDasharray="3 7"
              />
            )
          })}
        </svg>

        {/* Spaces */}
        {Array.from({ length: BOARD_SIZE }, (_, i) => {
          const meta = SPACE_TYPE_META[SPACE_TYPES[i]]
          const { x, y } = percentForIndex(i)
          const isLast = match.lastSpace?.pos === i
          const occupied = match.players.filter((p) => p.pos === i)
          return (
            <div
              key={i}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-black/55 px-1 py-1 text-center transition-all duration-500',
                isLast ? 'border-blood-bright shadow-[0_0_30px_rgba(224,52,44,0.5)] scale-125' : 'border-bone-faint/25'
              )}
              style={{ left: `${x}%`, top: `${y}%`, width: '9%', minWidth: 74 }}
            >
              <span className="block text-base leading-none" style={{ color: meta.accent }}>
                {meta.glyph}
              </span>
              <span className="mt-0.5 block truncate text-[0.55rem] uppercase tracking-wider text-bone-dim">
                {meta.label}
              </span>
            </div>
          )
        })}

        {/* Player tokens */}
        {match.players.map((p) => {
          const { x, y } = percentForIndex(p.pos)
          const offset = match.players.filter(
            (o) => o.pos === p.pos && o.id < p.id
          ).length
          return (
            <div
              key={p.id}
              className="token absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${x + offset * 2.4}%`,
                top: `${y - 5.5}%`,
                transitionDuration: match.awaiting === 'move' ? '380ms' : '700ms',
              }}
              title={p.name}
            >
              <div
                className={cn(
                  'grid h-11 w-11 place-items-center rounded-full border-2 font-display text-sm shadow-[0_6px_24px_rgba(0,0,0,0.7)]',
                  p.status === 'ghost'
                    ? 'animate-breathe border-hex-light bg-hex/30 text-hex-light'
                    : p.isTurn
                      ? 'border-blood-bright bg-blood-dark/80 text-bone token-active'
                      : 'border-bone-faint/60 bg-black/80 text-bone-dim'
                )}
              >
                {p.status === 'ghost' ? <Ghost size={18} /> : initialsOf(p.name)}
              </div>
              <span
                className={cn(
                  'mt-1 block rounded-full px-1.5 text-center text-[0.6rem] tabular-nums',
                  p.isTurn ? 'bg-blood/70 text-bone' : 'bg-black/70 text-bone-dim'
                )}
              >
                ✦{p.souls}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function initialsOf(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

/** Zoom toward the most recent dramatic space for a moment. */
function useZoomTarget(match: MatchView) {
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null)
  const lastRef = useRef('')
  useEffect(() => {
    const s = match.lastSpace
    const key = s ? `${s.pos}-${match.turnCount}` : ''
    if (!s || key === lastRef.current) return
    lastRef.current = key
    if (s.type === 'horror' || s.type === 'mystery') {
      const pct = percentForIndex(s.pos)
      setTarget(pct)
      getAudio().sting()
      const t = setTimeout(() => setTarget(null), 2400)
      return () => clearTimeout(t)
    }
  }, [match.lastSpace, match.turnCount])
  return target
}

/* ------------------------------------------------------------------ */
/* Rails & overlays                                                    */
/* ------------------------------------------------------------------ */

function StandingsRail({ match }: { match: MatchView }) {
  const sorted = [...match.players].sort((a, b) => b.souls - a.souls)
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-2">
      <p className="text-[0.6rem] uppercase tracking-widest2 text-bone-faint">Standings</p>
      {sorted.map((p, i) => (
        <div
          key={p.id}
          className={cn(
            'card-seal flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-500',
            p.isTurn && '!border-blood-bright/70'
          )}
        >
          <span className="font-display text-lg text-bone-faint">{i + 1}</span>
          {p.status === 'ghost' ? (
            <Ghost size={18} className="text-hex-light" />
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.07] font-display text-xs">
              {initialsOf(p.name)}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
          {p.itemCount > 0 ? (
            <span className="rounded bg-moss/25 px-1.5 text-[0.65rem] text-moss">✚{p.itemCount}</span>
          ) : null}
          {p.curses.length > 0 ? (
            <span className="rounded bg-blood/25 px-1.5 text-[0.65rem] text-blood-bright">☠{p.curses.length}</span>
          ) : null}
          <span className="font-display text-xl tabular-nums">{p.souls}</span>
        </div>
      ))}
    </aside>
  )
}

function EventTicker({ match }: { match: MatchView }) {
  const lines = match.log.slice(-3)
  return (
    <footer className="mt-4 flex h-16 items-start justify-center gap-10 overflow-hidden text-center">
      {lines.map((l, i) => (
        <p
          key={`${l.at}-${i}`}
          className={cn(
            'max-w-md text-sm italic leading-snug',
            i === lines.length - 1 ? 'fade-in-slow text-bone' : 'opacity-40'
          )}
        >
          {l.line}
        </p>
      ))}
    </footer>
  )
}

function BoardIntroCinematic() {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/85">
      <div className="fade-in-slow text-center">
        <Skull size={52} className="mx-auto animate-breathe text-blood-bright" />
        <h2 className="mt-8 font-display text-5xl tracking-widest2 text-shadow-cine">
          THE MANSION OPENS ITS DOORS
        </h2>
        <p className="mt-4 max-w-xl italic text-bone-dim">
          Roll. Move. Gather what souls remain. The house keeps count of everyone.
        </p>
      </div>
    </div>
  )
}

function MinigameSoonBanner({ phase }: { phase: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (phase !== 'minigame_intro') return
    setShow(true)
    getAudio().whoosh(1.4)
    const t = setTimeout(() => setShow(false), 4600)
    return () => clearTimeout(t)
  }, [phase])
  if (!show) return null
  return (
    <div className="fixed inset-0 z-40 grid place-items-center">
      <div className="glitch-in card-seal rounded-2xl px-14 py-10 text-center !border-blood/60 blood-pulse">
        <Crown size={34} className="mx-auto mb-4 text-blood-bright" />
        <p className="font-display text-3xl tracking-widest2">A GAME BECKONS</p>
        <p className="mt-2 animate-breathe text-sm uppercase tracking-widest2 text-bone-dim">
          Check your phones…
        </p>
      </div>
    </div>
  )
}

function MinigameResultsOverlay({
  mg,
  players,
}: {
  mg: NonNullable<MatchView['mg']>
  players: MatchView['players']
}) {
  if (!mg.results) return null
  const rows = [...mg.results].sort((a, b) => b.soulsDelta - a.soulsDelta)
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/80">
      <div className="card-seal fade-in-slow w-[min(720px,92vw)] rounded-2xl p-8">
        <h3 className="mb-1 text-center font-display text-3xl tracking-widest2">{mg.name}</h3>
        <p className="mb-6 text-center text-xs uppercase tracking-widest2 text-bone-faint">
          souls change hands
        </p>
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const p = players.find((x) => x.id === r.playerId)
            return (
              <li
                key={r.playerId}
                className="flex items-center justify-between rounded-xl bg-black/45 px-5 py-3"
              >
                <span className="font-display text-lg">{p?.name ?? '?'}</span>
                <span className="min-w-0 flex-1 truncate px-6 text-center text-xs italic text-bone-dim">
                  {r.note}
                </span>
                <span
                  className={cn(
                    'font-display text-2xl tabular-nums',
                    r.soulsDelta > 0 ? 'text-hex-light' : r.soulsDelta < 0 ? 'text-blood-bright' : 'text-bone-faint'
                  )}
                >
                  {r.soulsDelta > 0 ? `+${r.soulsDelta}` : r.soulsDelta}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
