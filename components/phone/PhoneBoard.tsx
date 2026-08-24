'use client'

/**
 * Phone controller for the mansion board — dice roll, souls/status header,
 * items & curses trays with targeting, and ghost-mode haunt actions.
 */

import { useState } from 'react'
import { Dices, Ghost, Skull } from 'lucide-react'
import type { WhisperGame } from '@/lib/whisper/useWhisper'
import type { MatchView, PlayerView } from '@/lib/whisper/protocol'
import { CURSE_META, ITEM_META, SPACE_TYPE_META } from '@/data/mansion'
import { getAudio } from '@/lib/whisper/audio'
import { cn } from '@/lib/utils'

export function PhoneBoard({
  view,
  match,
  priv,
  game,
}: {
  view: PlayerView
  match: MatchView
  priv: NonNullable<PlayerView['me']['matchPriv']>
  game: WhisperGame
}) {
  const me = match.players.find((p) => p.id === view.me.id)
  const [showItems, setShowItems] = useState(false)
  if (!me) return null

  return (
    <div className="flex min-h-dvh flex-col p-4 safe-top safe-bottom">
      {/* Status strip */}
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[0.6rem] uppercase tracking-widest2 text-bone-faint">
            Turn {Math.min(match.turnCount + 1, match.totalTurns)}/{match.totalTurns} · the house is{' '}
            {match.stageName.toLowerCase()}
          </p>
          <h2 className="font-display text-lg tracking-widest2">{view.me.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-hex/20 px-3 py-1 font-display text-xl tabular-nums text-hex-light">
            ✦{priv.souls}
          </span>
          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-sm text-bone-dim">#{priv.pos + 1}</span>
        </div>
      </header>

      {/* Curses */}
      {priv.curses.length > 0 ? (
        <ul className="mb-3 space-y-1.5">
          {priv.curses.map((c) => (
            <li key={c} className="rounded-xl border border-blood/40 bg-blood-dark/30 px-3 py-2 text-xs">
              <span className="mr-1.5">☠</span>
              <b>{CURSE_META[c]?.name ?? c}</b> — <span className="italic text-bone-dim">{CURSE_META[c]?.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Main area by state */}
      <div className="flex min-h-0 flex-1 flex-col">
        {me.status === 'ghost' ? (
          <GhostPanel match={match} view={view} game={game} />
        ) : priv.awaitingMe === 'roll' ? (
          <RollPanel onRoll={game.actions.roll} />
        ) : priv.awaitingMe === 'move' || priv.awaitingMe === 'haunt' ? (
          <WaitingCard line={priv.awaitingMe === 'haunt' ? 'Choose who to haunt…' : 'Moving…'} />
        ) : (
          <WaitingCard
            line={
              match.mg
                ? 'A game calls… watch the TV.'
                : `${match.players.find((p) => p.id === match.currentPlayerId)?.name ?? 'Someone'} moves…`
            }
          />
        )}
      </div>

      {/* Items tray */}
      <button
        onClick={() => setShowItems((v) => !v)}
        disabled={priv.items.length === 0}
        className={cn(
          'btn-cine mt-3 rounded-2xl py-3.5',
          priv.items.length > 0 ? '' : 'opacity-40'
        )}
      >
        ✚ Items ({priv.items.length})
      </button>
      {showItems && priv.items.length > 0 ? (
        <ItemsSheet items={priv.items} game={game} canUse={priv.isMyTurn && priv.awaitingMe === 'roll'} players={match.players} onClose={() => setShowItems(false)} />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function RollPanel({ onRoll }: { onRoll: () => void }) {
  const [rolling, setRolling] = useState(false)
  return (
    <div className="grid flex-1 place-items-center">
      <button
        className="group relative grid h-44 w-44 place-items-center rounded-full border-2 border-blood-bright/70 bg-blood-dark/40 active:scale-95 transition-transform"
        onClick={() => {
          setRolling(true)
          getAudio().knock(2)
          onRoll()
          setTimeout(() => setRolling(false), 900)
        }}
      >
        <span className="pulse-ring absolute inset-0 rounded-full border border-blood-bright/50" aria-hidden />
        <Dices size={54} className={cn('text-blood-bright', rolling && 'dice-tumble')} />
        <span className="mt-2 font-display tracking-widest2">ROLL</span>
      </button>
    </div>
  )
}

function WaitingCard({ line }: { line: string }) {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <div>
        <Ghost size={34} className="mx-auto mb-4 animate-breathe text-bone-faint" />
        <p className="animate-breathe italic text-bone-dim">{line}</p>
      </div>
    </div>
  )
}

function GhostPanel({
  match,
  view,
  game,
}: {
  match: MatchView
  view: PlayerView
  game: WhisperGame
}) {
  const targets = match.players.filter(
    (p) => p.status !== 'ghost' && p.pos === view.me.matchPriv?.pos
  )
  const hauntOpen = view.me.matchPriv?.awaitingMe === 'haunt'
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
      <Ghost size={48} className="text-hex-light animate-breathe" />
      <p className="max-w-xs italic leading-relaxed text-bone-dim">
        You drift where you fell. Haunt the living when you share their room.
      </p>
      {hauntOpen ? (
        targets.length > 0 ? (
          <div className="w-full max-w-xs space-y-2">
            {targets.map((t) => (
              <button key={t.id} onClick={() => game.actions.haunt(t.id)} className="btn-cine w-full rounded-2xl py-3.5 !border-hex-light/50">
                Haunt {t.name}
              </button>
            ))}
            <button onClick={() => game.actions.haunt()} className="w-full py-2 text-xs uppercase tracking-widest2 text-bone-faint">
              spare them
            </button>
          </div>
        ) : (
          <p className="text-sm uppercase tracking-widest2 text-bone-faint">no one here to haunt…</p>
        )
      ) : (
        <p className="text-sm uppercase tracking-widest2 text-bone-faint">waiting for your drift turn</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

function ItemsSheet({
  items,
  game,
  canUse,
  players,
  onClose,
}: {
  items: string[]
  game: WhisperGame
  canUse: boolean
  players: MatchView['players']
  onClose: () => void
}) {
  const [targeting, setTargeting] = useState<string | null>(null)

  if (targeting) {
    const others = players.filter((p) => p.status !== 'ghost')
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4 safe-top safe-bottom">
        <h3 className="mb-4 text-center font-display tracking-widest2">CHOOSE A VICTIM</h3>
        <div className="flex-1 space-y-2 overflow-y-auto">
          {others.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                game.actions.useItem(targeting, p.id)
                getAudio().whoosh(0.8)
                setTargeting(null)
                onClose()
              }}
              className="card-seal flex w-full items-center justify-between rounded-2xl px-4 py-4"
            >
              <span className="truncate">{p.name}</span>
              <Skull size={18} className="text-blood-bright" />
            </button>
          ))}
        </div>
        <button onClick={() => setTargeting(null)} className="mt-3 text-xs uppercase tracking-widest2 text-bone-faint">
          back
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4 safe-top safe-bottom">
      <h3 className="mb-4 text-center font-display tracking-widest2">YOUR POCKETS</h3>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {items.map((id, i) => {
          const meta = ITEM_META[id]
          if (!meta) return null
          const needsTarget = id === 'voodoo_doll' || id === 'snuffed_candle'
          return (
            <div key={`${id}-${i}`} className="card-seal rounded-2xl px-4 py-3.5">
              <p className="font-display">✚ {meta.name}</p>
              <p className="mt-0.5 text-xs italic leading-relaxed text-bone-dim">{meta.text}</p>
              <button
                disabled={!canUse}
                onClick={() => {
                  if (!canUse) return
                  if (needsTarget) setTargeting(id)
                  else {
                    game.actions.useItem(id)
                    getAudio().whoosh(0.8)
                    onClose()
                  }
                }}
                className={cn(
                  'mt-2 w-full rounded-xl border py-2.5 text-xs uppercase tracking-widest2',
                  canUse ? 'border-moss/60 text-moss' : 'border-bone-faint/25 text-bone-faint opacity-50'
                )}
              >
                {canUse ? 'use' : 'usable only on your roll'}
              </button>
            </div>
          )
        })}
      </div>
      <button onClick={onClose} className="mt-3 text-xs uppercase tracking-widest2 text-bone-faint">
        close
      </button>
    </div>
  )
}
