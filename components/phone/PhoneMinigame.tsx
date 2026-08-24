'use client'

/**
 * Phone-side minigames — five touch controllers driven by the public
 * snapshot (match.mg.publicState) plus the player's private slice
 * (me.matchPriv.privateMg). All input funnels through game.actions.mgInput.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eye, EyeOff, Flame, Skull } from 'lucide-react'
import type { MgPublic, PlayerView } from '@/lib/whisper/protocol'
import type { WhisperGame } from '@/lib/whisper/useWhisper'
import { getAudio } from '@/lib/whisper/audio'
import { cn } from '@/lib/utils'

type Priv = NonNullable<PlayerView['me']['matchPriv']>

export function PhoneMinigame({
  view,
  mg,
  priv,
  game,
}: {
  view: PlayerView
  mg: MgPublic
  priv: Priv
  game: WhisperGame
}) {
  const results = mg.results

  return (
    <div className="flex min-h-dvh flex-col p-4 safe-top safe-bottom">
      <header className="mb-3 text-center">
        <h2 className="font-display tracking-widest2">{mg.name}</h2>
        <p className="text-[0.7rem] italic text-bone-dim">{mg.tagline}</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {results ? (
          <ResultsList mg={mg} myId={view.me.id} />
        ) : mg.id === 'candle' ? (
          <TapFrenzy priv={priv} game={game} />
        ) : mg.id === 'chase' ? (
          <HoldToRun priv={priv} game={game} />
        ) : mg.id === 'dontlook' ? (
          <DontLook priv={priv} mg={mg} myId={view.me.id} game={game} />
        ) : mg.id === 'sacrifice' ? (
          <SecretVote priv={priv} mg={mg} view={view} game={game} />
        ) : mg.id === 'maze' ? (
          <MazePad priv={priv} mg={mg} myId={view.me.id} game={game} />
        ) : (
          <p className="grid flex-1 place-items-center italic text-bone-dim">watch the TV…</p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Candle — tap as fast as you dare                                    */
/* ------------------------------------------------------------------ */

function TapFrenzy({ priv, game }: { priv: Priv; game: WhisperGame }) {
  const myTaps = (priv.privateMg?.myTaps as number | undefined) ?? 0
  return (
    <div className="grid flex-1 place-items-center">
      <button
        onPointerDown={(e) => {
          e.preventDefault()
          getAudio().knock(1)
          game.actions.mgInput({ type: 'tap' })
        }}
        className="relative grid h-56 w-56 select-none place-items-center rounded-full border-2 border-blood-bright/60 bg-blood-dark/30 active:bg-blood-dark/70"
      >
        <span className="pulse-ring absolute inset-0 rounded-full border border-blood/40" aria-hidden />
        <Flame size={64} className="animate-breathe text-blood-bright" />
        <span className="mt-1 font-display text-4xl tabular-nums">{myTaps}</span>
      </button>
      <p className="mt-6 text-xs uppercase tracking-widest2 text-bone-faint">tap! tap! tap!</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Chase — hold to run, watch your stamina                             */
/* ------------------------------------------------------------------ */

function HoldToRun({ priv, game }: { priv: Priv; game: WhisperGame }) {
  const pm = (priv.privateMg ?? {}) as { stamina?: number; running?: boolean; caughtAt?: number | null }
  const caught = pm.caughtAt != null
  const stamina = pm.stamina ?? 100

  const down = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      if (!caught) game.actions.mgInput({ type: 'run_on' })
    },
    [caught, game]
  )
  const up = useCallback(() => game.actions.mgInput({ type: 'run_off' }), [game])

  useEffect(() => up, [up])

  if (caught) {
    return (
      <div className="grid flex-1 place-items-center text-center">
        <Skull size={56} className="mx-auto animate-glitch text-blood-bright" />
        <p className="mt-4 font-display tracking-widest2 text-blood-bright">IT CAUGHT YOU</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8">
      <div className="w-full max-w-xs">
        <p className="mb-1.5 text-[0.65rem] uppercase tracking-widest2 text-bone-faint">stamina</p>
        <div className="h-3 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className={cn('h-full rounded-full transition-all duration-200', stamina < 25 ? 'bg-blood-bright' : 'bg-moss')}
            style={{ width: `${stamina}%` }}
          />
        </div>
      </div>
      <button
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={up}
        onPointerCancel={up}
        className={cn(
          'select-none rounded-full border-2 py-16 text-center font-display text-xl tracking-widest2 active:scale-95 transition-transform',
          pm.running ? 'border-moss bg-moss/20 text-bone' : 'border-bone-faint bg-black/50 text-bone-dim'
        )}
        style={{ width: 220 }}
      >
        {pm.running ? 'RUNNING' : 'HOLD TO RUN'}
      </button>
      <p className="max-w-xs text-center text-xs italic leading-relaxed text-bone-dim">
        Hold to sprint. Stamina drains — lift to recover before it empties.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Don't look — tap only while the eyes are shut                       */
/* ------------------------------------------------------------------ */

function DontLook({
  priv,
  mg,
  myId,
  game,
}: {
  priv: Priv
  mg: MgPublic
  myId: string
  game: WhisperGame
}) {
  const ps = mg.publicState as
    | { eyeOpen: boolean; counts: Record<string, number>; stings: Record<string, number> }
    | undefined
  const eyeOpen = ps?.eyeOpen ?? false
  const taps = ps?.counts[myId] ?? 0
  const stings = ps?.stings[myId] ?? 0
  const prevEye = useRef(eyeOpen)

  useEffect(() => {
    if (prevEye.current !== eyeOpen) {
      prevEye.current = eyeOpen
      getAudio().sting()
    }
  }, [eyeOpen])

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7">
      {eyeOpen ? <Eye size={72} className="animate-breathe text-blood-bright" /> : <EyeOff size={64} className="text-bone-faint" />}
      <p
        className={cn(
          'font-display tracking-widest2',
          eyeOpen ? 'text-blood-bright' : 'text-bone-dim'
        )}
      >
        {eyeOpen ? 'FREEZE' : 'TAP'}
      </p>
      <button
        disabled={eyeOpen}
        onPointerDown={(e) => {
          e.preventDefault()
          if (!eyeOpen) game.actions.mgInput({ type: 'tap' })
        }}
        className={cn(
          'grid h-44 w-44 select-none place-items-center rounded-full border-2 font-display text-5xl tabular-nums',
          eyeOpen
            ? 'border-blood-bright/80 bg-blood-dark/50 text-blood-bright opacity-90'
            : 'border-bone-faint/60 bg-black/60 text-bone active:bg-white/[0.06]'
        )}
      >
        {taps}
      </button>
      {stings > 0 ? <p className="text-sm tabular-nums text-blood-bright">✕ caught {stings}× (−4 each)</p> : <p className="text-sm text-bone-faint">&nbsp;</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sacrifice — one sealed vote                                         */
/* ------------------------------------------------------------------ */

function SecretVote({
  priv,
  mg,
  view,
  game,
}: {
  priv: Priv
  mg: MgPublic
  view: PlayerView
  game: WhisperGame
}) {
  const voted = Boolean(priv.privateMg?.voted)
  const eligible = ((mg.publicState?.eligible ?? []) as string[])
    .map((id) => view.players.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))

  if (voted) {
    return (
      <div className="grid flex-1 place-items-center text-center">
        <Flame size={52} className="mx-auto animate-breathe text-blood-bright" />
        <p className="mt-5 max-w-xs italic leading-relaxed text-bone-dim">
          Your choice is sealed. The altar weighs all names when every soul has spoken.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-2.5 overflow-y-auto pt-2">
      {eligible.map((p) => (
        <button
          key={p.id}
          onClick={() => {
            getAudio().whoosh(0.9)
            game.actions.mgInput({ type: 'vote', targetId: p.id })
          }}
          className="card-seal flex w-full items-center justify-between rounded-2xl px-5 py-4"
        >
          <span className="truncate font-display">{p.name}</span>
          <Skull size={18} className="text-blood-bright" />
        </button>
      ))}
      <p className="px-2 pt-3 text-center text-xs italic leading-relaxed text-bone-faint">
        Majority sends a soul down (+1 to you if right). If they survive, you lose 2.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Maze — d-pad race                                                   */
/* ------------------------------------------------------------------ */

const DIRS = [
  { dir: 'up', Icon: ChevronUp },
  { dir: 'left', Icon: ChevronLeft },
  { dir: 'down', Icon: ChevronDown },
  { dir: 'right', Icon: ChevronRight },
] as const

function MazePad({
  priv,
  mg,
  myId,
  game,
}: {
  priv: Priv
  mg: MgPublic
  myId: string
  game: WhisperGame
}) {
  const ps = mg.publicState as
    | { pos: Record<string, { x: number; y: number }>; doneOrder: string[] }
    | undefined
  const mePos = ps?.pos[myId]
  const rank = ps?.doneOrder.indexOf(myId)

  if (rank != null && rank >= 0) {
    return (
      <div className="grid flex-1 place-items-center text-center">
        <p className="font-display text-3xl tracking-widest2 text-moss">ESCAPED</p>
        <p className="mt-2 italic text-bone-dim">#{rank + 1} out of the dark.</p>
      </div>
    )
  }

  return (
    <div className="grid flex-1 place-items-center">
      <div className="grid grid-cols-3 grid-rows-3 gap-2">
        <span />
        <DirBtn {...DIRS[0]} game={game} />
        <span />
        <DirBtn {...DIRS[1]} game={game} />
        <span className="grid h-14 w-14 place-items-center rounded-xl bg-black/50 text-[0.55rem] uppercase tracking-wider text-bone-faint">
          {mePos ? `${mePos.x},${mePos.y}` : ''}
        </span>
        <DirBtn {...DIRS[3]} game={game} />
        <span />
        <DirBtn {...DIRS[2]} game={game} />
        <span />
      </div>
      <p className="mt-8 max-w-xs text-center text-xs italic leading-relaxed text-bone-dim">
        Find the moss-lit door in the bottom-right corner.
      </p>
    </div>
  )
}

function DirBtn({
  dir,
  Icon,
  game,
}: {
  dir: 'up' | 'down' | 'left' | 'right'
  Icon: typeof ChevronUp
  game: WhisperGame
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault()
        getAudio().knock(1)
        game.actions.mgInput({ type: 'move', dir })
      }}
      className="grid h-14 w-14 select-none place-items-center rounded-xl border border-bone-faint/50 bg-black/55 text-bone active:bg-white/[0.08]"
    >
      <Icon size={26} />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Shared results list                                                 */
/* ------------------------------------------------------------------ */

function ResultsList({ mg, myId }: { mg: MgPublic; myId: string }) {
  const rows = [...(mg.results ?? [])].sort((a, b) => b.soulsDelta - a.soulsDelta)
  return (
    <div className="flex-1 space-y-2 overflow-y-auto pt-2">
      <p className="pb-1 text-center text-xs uppercase tracking-widest2 text-bone-faint">
        souls change hands
      </p>
      {rows.map((r) => (
        <div
          key={r.playerId}
          className={cn(
            'flex items-center justify-between rounded-xl px-4 py-3',
            r.playerId === myId ? 'bg-blood-dark/35 ring-1 ring-blood-bright/50' : 'bg-black/45'
          )}
        >
          <span className="truncate">{r.note}</span>
          <span
            className={cn(
              'ml-3 shrink-0 font-display text-xl tabular-nums',
              r.soulsDelta > 0 ? 'text-hex-light' : r.soulsDelta < 0 ? 'text-blood-bright' : 'text-bone-faint'
            )}
          >
            {r.soulsDelta > 0 ? `+${r.soulsDelta}` : r.soulsDelta}
          </span>
        </div>
      ))}
    </div>
  )
}
