'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Ghost, Inbox, Lock, Skull, Sparkles, UserRound, Vote } from 'lucide-react'
import type { WhisperGame } from '@/lib/whisper/useWhisper'
import type { PlayerView, WhisperInMsg } from '@/lib/whisper/protocol'
import { getAudio } from '@/lib/whisper/audio'
import { cn, initials } from '@/lib/utils'
import { CountdownBar } from './Atmosphere'
import { MicButton } from './MicButton'
import { ForgeModal } from './ForgeModal'
import { WhisperInbox } from './WhisperInbox'
import { PHASE_LABELS } from '@/data/whisper'

export function PhoneStage({ game }: { game: WhisperGame }) {
  const view = game.playerView
  const audio = getAudio()
  const seenIds = useRef<Set<string>>(new Set())

  // A whisper just arrived: shiver.
  useEffect(() => {
    if (game.inbox.length === 0) return
    const last = game.inbox[game.inbox.length - 1]
    if (seenIds.current.has(last.id)) return
    seenIds.current.add(last.id)
    navigator.vibrate?.(last.stolen ? [30, 40, 30] : 24)
    audio.whoosh(0.7)
  }, [game.inbox, audio])

  if (!view) {
    return (
      <Shell>
        <div className="grid place-items-center py-24">
          <Ghost className="mb-4 animate-breathe text-hex" size={42} />
          <p className="text-sm tracking-widest2 text-bone-dim">SEEKING THE HOUSE…</p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <TopBar view={view} game={game} />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-44">
        {view.phase === 'lobby' && <Lobby view={view} />}
        {view.phase === 'intro' && <Intro />}
        {view.phase === 'secrets' && <Secrets view={view} />}
        {view.phase === 'whisper' && <Whispering view={view} game={game} />}
        {view.phase === 'omen' && <Omen view={view} />}
        {view.phase === 'vote' && <Voting view={view} game={game} />}
        {view.phase === 'ending' && <Ending view={view} game={game} />}
      </main>
    </Shell>
  )
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="safe-top relative z-10 flex min-h-dvh flex-col">{children}</div>
  )
}

function TopBar({ view, game }: { view: PlayerView; game: WhisperGame }) {
  const [inboxOpen, setInboxOpen] = useState(false)
  const totalMs =
    view.phase === 'whisper'
      ? (view.roundSeconds ?? 75) * 1000
      : (view.voteSeconds ?? 40) * 1000
  return (
    <>
      <header className="mb-2 flex items-center justify-between px-4">
        <span className="font-display text-sm tracking-widest3 text-bone-faint">
          {view.code}
        </span>
        <span className="text-[0.65rem] uppercase tracking-widest2 text-bone-faint">
          {PHASE_LABELS[view.phase] ?? view.phase}
          {view.phase === 'whisper' ? ` · ${view.round}/${view.rounds}` : ''}
        </span>
        <button
          aria-label="Received whispers"
          onClick={() => {
            setInboxOpen(true)
            game.actions.markInboxRead()
          }}
          className="relative grid h-9 w-9 place-items-center rounded-full border border-bone-faint/25 bg-black/40"
        >
          <Inbox size={16} className="text-bone-dim" />
          {view.me.unread > 0 ? (
            <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-blood text-[0.65rem] font-semibold">
              {Math.min(view.me.unread, 9)}
            </span>
          ) : null}
        </button>
      </header>
      {(view.phase === 'whisper' || view.phase === 'vote') && (
        <div className="px-4 pb-3">
          <CountdownBar endsAt={view.phaseEndsAt} now={view.now} totalMs={totalMs} />
        </div>
      )}
      {inboxOpen ? (
        <WhisperInbox
          inbox={game.inbox}
          onClose={() => setInboxOpen(false)}
          isWhisperer={view.me.role === 'whisperer'}
        />
      ) : null}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

function Lobby({ view }: { view: PlayerView }) {
  return (
    <section className="pt-10 text-center">
      <UserRound size={40} className="mx-auto animate-breathe text-hex" />
      <h1 className="mt-4 font-display text-3xl tracking-wide">You are seated</h1>
      <p className="mt-2 font-display text-xl text-blood-bright">{view.me.name}</p>
      <p className="mx-auto mt-6 max-w-xs text-sm leading-relaxed text-bone-dim">
        Wait by candlelight. The ritual begins when the house is ready.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {view.players.map((p) => (
          <span
            key={p.id}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm',
              p.connected ? 'border-bone-faint/40 text-bone' : 'border-white/5 text-bone-faint/50'
            )}
          >
            {p.name}
          </span>
        ))}
      </div>
    </section>
  )
}

function Intro() {
  return (
    <section className="grid place-items-center pt-20 text-center">
      <Sparkles size={38} className="animate-breathe text-hex-light" />
      <p className="mt-6 max-w-xs font-display text-lg leading-relaxed text-bone-dim">
        The house is speaking. Listen.
      </p>
    </section>
  )
}

function Secrets({ view }: { view: PlayerView }) {
  const [revealed, setRevealed] = useState(false)
  const me = view.me
  const isW = me.role === 'whisperer'

  return (
    <section className="pt-8">
      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="card-seal mx-auto flex aspect-[3/4] w-full max-w-xs flex-col items-center justify-center gap-4 rounded-3xl transition-transform active:scale-[0.98]"
        >
          <Lock size={36} className="text-hex" />
          <p className="px-8 font-display text-xl leading-relaxed text-bone">
            Hold your breath.
          </p>
          <p className="text-xs uppercase tracking-widest2 text-bone-faint">
            Tap to face your truth
          </p>
        </button>
      ) : (
        <div className={cn('card-seal rounded-3xl p-6', isW ? 'blood-pulse' : '')}>
          <p
            className={cn(
              'text-center font-display text-2xl tracking-widest2',
              isW ? 'text-blood-bright' : 'text-bone'
            )}
          >
            {isW ? 'THE WHISPERER' : 'INNOCENT'}
          </p>

          <div className="mt-5 rounded-xl bg-black/40 p-4">
            <p className="text-[0.65rem] uppercase tracking-widest2 text-bone-faint">
              Your memory
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-bone">{me.secret}</p>
            {me.baitWord ? (
              <p className="mt-3 inline-block rounded border border-hex/50 bg-hex/10 px-2.5 py-1 font-mono text-sm text-hex-light">
                {me.baitWord}
              </p>
            ) : null}
          </div>

          {me.objective ? (
            <div className="mt-4 rounded-xl bg-black/40 p-4">
              <p className="text-[0.65rem] uppercase tracking-widest2 text-blood-bright">
                {me.objective.label}
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-bone">{me.objective.text}</p>
              <p className="mt-2 text-xs italic text-bone-faint">{me.objective.hint}</p>
            </div>
          ) : null}

          {isW ? (
            <p className="mt-4 text-center text-xs leading-relaxed text-blood-bright/90">
              You hear every whisper. Once a round, speak with a borrowed voice.
            </p>
          ) : (
            <p className="mt-4 text-center text-xs text-bone-faint">
              One of you whispers for it. Trust nothing spoken twice.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function Whispering({ view, game }: { view: PlayerView; game: WhisperGame }) {
  const [targetId, setSelected] = useState<string | null>(null)
  const [holding, setHolding] = useState(false)
  const [forgeOpen, setForgeOpen] = useState(false)
  const me = view.me
  const targets = view.players.filter((p) => p.id !== me.id)
  const target = targets.find((t) => t.id === targetId)

  useEffect(() => {
    if (targetId && !targets.some((t) => t.id === targetId)) setSelected(null)
  }, [targets, targetId])

  const objProgress = useMemo(() => {
    const o = me.objective
    if (!o) return ''
    if (o.kind === 'listeners') return `${me.heardFromCount}/${o.payload.count ?? '?'}`
    if (o.kind === 'bait') return o.done ? 'done' : `"${o.payload.word}"`
    if (o.kind === 'silence') return o.done ? 'kept' : `round ${o.payload.round}`
    return ''
  }, [me])

  return (
    <>
      {me.objective ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-black/35 px-3 py-2">
          <Skull size={14} className={me.objective.done ? 'text-moss' : 'text-blood-bright'} />
          <p className="flex-1 truncate text-xs text-bone-dim">{me.objective.text}</p>
          <span
            className={cn(
              'shrink-0 text-xs font-medium',
              me.objective.done ? 'text-moss' : 'text-hex-light'
            )}
          >
            {objProgress}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2.5">
        {targets.map((p) => (
          <button
            key={p.id}
            disabled={holding}
            onClick={() => setSelected(p.id)}
            className={cn(
              'card-seal flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl p-2 transition-all duration-200 active:scale-95',
              targetId === p.id ? '!border-blood-bright shadow-[0_0_28px_rgba(224,52,44,0.35)]' : '',
              !p.connected && 'opacity-40'
            )}
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.06] font-display text-lg">
              {initials(p.name)}
            </span>
            <span className="max-w-full truncate px-1 text-sm text-bone">{p.name}</span>
          </button>
        ))}
      </div>

      {me.role === 'whisperer' ? (
        <button
          disabled={me.forgeUsed || holding}
          onClick={() => setForgeOpen(true)}
          className="wsp-btn-primary mt-4 w-full !py-3 text-xs disabled:opacity-40"
        >
          {me.forgeUsed ? 'Borrowed voice spent this round' : 'Speak with a borrowed voice'}
        </button>
      ) : null}

      <MicButton
        disabled={!targetId || !target?.connected}
        targetName={target?.name}
        onBegin={() => {
          if (!targetId) return
          setHolding(true)
          game.actions.beginWhisper(targetId)
        }}
        onChunk={(text) => game.actions.pushChunk(text)}
        onEnd={() => {
          setHolding(false)
          game.actions.endWhisper()
        }}
        onCancel={() => game.actions.cancelWhisper()}
      />

      {forgeOpen ? (
        <ForgeModal
          targets={targets}
          onClose={() => setForgeOpen(false)}
          onSend={(toId, text) => {
            game.actions.forge(toId, text)
            setForgeOpen(false)
          }}
        />
      ) : null}
    </>
  )
}

function Omen({ view }: { view: PlayerView }) {
  useEffect(() => {
    navigator.vibrate?.([80, 60, 120])
    getAudio().sting()
  }, [])
  return (
    <section className="blood-pulse -mx-4 grid min-h-[70dvh] place-items-center px-8 text-center">
      <div>
        <Skull size={44} className="mx-auto animate-glitch text-blood-bright" />
        <p className="mt-8 font-display text-2xl leading-relaxed text-shadow-cine">
          Something stirs between rounds…
        </p>
        <p className="mt-3 text-xs uppercase tracking-widest2 text-bone-faint">
          Round {Math.min(view.round + 1, view.rounds)} approaches
        </p>
      </div>
    </section>
  )
}

function Voting({ view, game }: { view: PlayerView; game: WhisperGame }) {
  const [pick, setPick] = useState<string | null>(null)
  const candidates = view.players.filter((p) => p.id !== view.me.id)
  const sealed = view.me.voteSealed

  useEffect(() => {
    getAudio().knock(2)
  }, [])

  if (sealed) {
    return (
      <section className="grid place-items-center pt-20 text-center">
        <Lock size={36} className="animate-breathe text-moss" />
        <p className="mt-5 font-display text-xl">Your ballot burned.</p>
        <p className="mt-2 max-w-xs text-sm text-bone-dim">
          {view.publicStats.votesCast}/{view.players.length} votes cast. The table holds its
          breath.
        </p>
      </section>
    )
  }

  return (
    <section className="pt-4">
      <div className="mb-4 text-center">
        <Vote size={30} className="mx-auto text-blood-bright" />
        <h2 className="mt-3 font-display text-2xl">Who whispers for it?</h2>
        <p className="mt-1 text-xs uppercase tracking-widest2 text-bone-faint">
          {view.publicStats.votesCast}/{view.players.length} sealed
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {candidates.map((p) => (
          <button
            key={p.id}
            onClick={() => setPick(p.id === pick ? null : p.id)}
            className={cn(
              'card-seal flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl p-2 active:scale-95',
              pick === p.id ? '!border-blood-bright shadow-[0_0_28px_rgba(224,52,44,0.35)]' : ''
            )}
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.06] font-display">
              {initials(p.name)}
            </span>
            <span className="max-w-full truncate px-1 text-sm">{p.name}</span>
          </button>
        ))}
      </div>
      <div className="mt-5 space-y-2">
        <button
          disabled={!pick}
          onClick={() => game.actions.castVote(pick)}
          className="wsp-btn-primary w-full disabled:opacity-40"
        >
          Seal their fate
        </button>
        <button
          onClick={() => game.actions.castVote(null)}
          className="wsp-btn-ghost w-full !py-3 text-xs"
        >
          Abstain — let the house decide
        </button>
      </div>
    </section>
  )
}

function Ending({ view, game }: { view: PlayerView; game: WhisperGame }) {
  const outcome = view.outcome
  const caught = outcome?.verdict === 'silence'
  useEffect(() => {
    getAudio()[caught ? 'chime' : 'sting']()
  }, [caught])

  return (
    <section className="pt-8 text-center">
      <h1
        className={cn(
          'font-display text-4xl tracking-wide text-shadow-cine',
          caught ? 'text-bone' : 'text-blood-bright'
        )}
      >
        {caught ? 'THE SILENCE' : 'THE HOLLOW WAKES'}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-bone-dim">
        {caught
          ? 'Its tongue was cut out. The house exhales.'
          : 'The wrong throat was chosen. The choir grows.'}
      </p>

      {caught && outcome?.banishedName ? (
        <p className="mt-6 text-xs uppercase tracking-widest2 text-bone-faint">
          It wore{' '}
          <span className="font-display text-base normal-case tracking-normal text-blood-bright">
            {outcome.banishedName}
          </span>
          &apos;s voice
        </p>
      ) : null}

      <div className="card-seal mt-8 rounded-2xl p-5 text-left">
        <p className="text-[0.65rem] uppercase tracking-widest2 text-bone-faint">Your ending</p>
        <p className="mt-2 text-[15px] italic leading-relaxed text-bone">
          {view.me.epilogue ?? '…'}
        </p>
        {view.me.objective ? (
          <p
            className={cn(
              'mt-3 text-xs',
              view.me.objective.done ? 'text-moss' : 'text-blood-bright/80'
            )}
          >
            {view.me.objective.kind === 'whisperer'
              ? view.me.objective.done
                ? 'You were never unmasked.'
                : 'You were torn apart.'
              : view.me.objective.done
                ? 'Objective fulfilled.'
                : 'Objective failed.'}
          </p>
        ) : null}
      </div>

      <p className="mt-8 text-xs text-bone-faint">The TV decides what happens next.</p>
      <button
        onClick={() => game.actions.leave()}
        className="mt-3 text-xs underline text-bone-faint/60 hover:text-bone-dim"
      >
        leave the house
      </button>
    </section>
  )
}
