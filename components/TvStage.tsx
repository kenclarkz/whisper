'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Ghost,
  Play,
  RotateCcw,
  Skull,
  UserRound,
} from 'lucide-react'
import type { WhisperGame } from '@/lib/whisper/useWhisper'
import type { RoomSettings, TvView } from '@/lib/whisper/protocol'
import { getAudio } from '@/lib/whisper/audio'
import { cn } from '@/lib/utils'
import { CountdownRing, Flame } from './Atmosphere'
import { QrPanel } from './QrPanel'
import { ErrorToast } from './ErrorToast'
import {
  HOW_TO_PLAY,
  HOW_TO_PLAY_MANSION,
  INTRO_NARRATION,
  LOBBY_WHISPERS,
  PHASE_LABELS,
} from '@/data/whisper'
import { MansionBoard } from './board/MansionBoard'
import { TvMinigame } from './board/TvMinigame'
import { ResultsCinema } from './board/ResultsCinema'

const ROUND_OPTIONS = [45, 60, 75, 90]
const VOTE_OPTIONS = [25, 40, 60]
const ROUNDS_OPTIONS = [2, 3, 4]
const LAPS_OPTIONS = [2, 3, 4]

export function TvStage({ game }: { game: WhisperGame }) {
  const tv = game.tvView

  /* Unlock + drone on first user gesture (browser autoplay policy). */
  useEffect(() => {
    const unlock = () => getAudio().unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  if (!tv) {
    return (
      <PreLobby game={game}>
        <ErrorToast game={game} />
      </PreLobby>
    )
  }
  return <Stage tv={tv} game={game} />
}

/* ------------------------------------------------------------------ */
/* Pre-lobby                                                           */
/* ------------------------------------------------------------------ */

function PreLobby({ game, children }: { game: WhisperGame; children?: React.ReactNode }) {
  return (
    <main className="relative z-10 grid min-h-dvh place-items-center">
      <div className="text-center">
        <Flame className="mx-auto h-16 w-12 animate-breathe text-blood" />
        <h1 className="mt-8 font-display text-7xl tracking-[0.22em] text-shadow-cine">WHISPER</h1>
        <p className="mt-3 text-sm italic text-bone-faint">
          This screen is the house. The phones are its guests.
        </p>
        <button
          onClick={() => game.actions.createRoom()}
          disabled={game.connState === 'connecting'}
          className="wsp-btn-primary mt-10 !px-10 !py-4 text-base tracking-widest disabled:opacity-40"
        >
          {game.connState === 'connecting'
            ? 'KNOCKING…'
            : game.connState === 'open'
              ? 'LIGHT THE CANDLES'
              : 'REACH FOR THE HOUSE'}
        </button>
        {children}
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------ */
/* Phase router                                                        */
/* ------------------------------------------------------------------ */

function Stage({ tv, game }: { tv: TvView; game: WhisperGame }) {
  const audio = useMemo(() => getAudio(), [])
  const lastPhase = useRef<string | null>(null)

  /* Phase-change sound design for the room. */
  useEffect(() => {
    if (lastPhase.current === tv.phase) return
    const prev = lastPhase.current
    lastPhase.current = tv.phase
    switch (tv.phase) {
      case 'intro':
        audio.startDrone()
        break
      case 'secrets':
        audio.knock(1)
        break
      case 'whisper':
        audio.whoosh(1.6)
        audio.startHeartbeat(0.35)
        break
      case 'omen':
        audio.sting()
        break
      case 'vote':
        audio.knock(2)
        break
      case 'ending':
        audio.stopHeartbeat()
        audio.setDread(0)
        ;(tv.outcome?.verdict === 'silence' ? audio.chime : audio.sting).call(audio)
        break
      case 'lobby':
        audio.stopHeartbeat()
        if (prev) audio.stopDrone()
        break
      default:
        break
    }
    // Phase-change effect must not re-fire on stat updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv.phase, audio])

  /* Dread drives the heartbeat tension + filter. */
  useEffect(() => {
    audio.setDread(Math.min(1, tv.publicStats.dread))
  }, [tv.publicStats.dread, audio])

  const isMansion = tv.settings.mode === 'mansion'

  if (isMansion && (tv.phase === 'board_intro' || tv.phase === 'board' || tv.phase === 'minigame_intro' || tv.phase === 'minigame_results')) {
    return (
      <>
        {tv.match ? <MansionBoard tv={tv} game={game} /> : null}
        <HostBar game={game} phase={tv.phase} />
      </>
    )
  }
  if (isMansion && tv.phase === 'minigame' && tv.match?.mg) {
    return (
      <>
        <TvMinigame mg={tv.match.mg} players={tv.match.players} now={tv.now} />
        <HostBar game={game} phase={tv.phase} />
      </>
    )
  }
  if (isMansion && tv.phase === 'results') {
    return tv.match ? <ResultsCinema match={tv.match} /> : null
  }

  if (tv.phase === 'ending') return <EndingCinema tv={tv} game={game} />
  return (
    <>
      {renderPhase()}
      <HostBar game={game} phase={tv.phase} />
    </>
  )

  function renderPhase() {
    switch (tv.phase) {
      case 'lobby':
        return <Lobby tv={tv} game={game} />
      case 'intro':
        return <Intro key={`intro-${tv.round}`} tv={tv} />
      case 'secrets':
        return <SecretsCinema />
      case 'whisper':
        return <WhisperRounds key={`whisper-${tv.round}`} tv={tv} />
      case 'omen':
        return <OmenCinema tv={tv} />
      case 'vote':
        return <VoteCinema tv={tv} />
      default:
        return null
    }
  }
}

/* ------------------------------------------------------------------ */
/* Lobby                                                               */
/* ------------------------------------------------------------------ */

function Lobby({ tv, game }: { tv: TvView; game: WhisperGame }) {
  const [settings, setSettings] = useState<RoomSettings>(tv.settings)
  const joinUrl =
    typeof window === 'undefined' ? '' : `${window.location.origin}/?code=${tv.code}`
  const isMansion = settings.mode === 'mansion'
  const canStart = tv.players.length >= 2 && tv.players.length <= 8
  const whisper = useRotating(LOBBY_WHISPERS, 4200)
  const howTo = isMansion ? HOW_TO_PLAY_MANSION : HOW_TO_PLAY

  return (
    <main className="relative z-10 flex min-h-dvh flex-col p-10 pb-24">
      <header className="mb-8 flex items-end justify-between">
        <h1 className="font-display text-5xl tracking-[0.2em]">WHISPER</h1>
        <span className="animate-breathe text-sm italic text-hex-light">{whisper}</span>
      </header>

      <div className="grid flex-1 grid-cols-[minmax(280px,380px)_1fr] gap-10">
        <div>
          <QrPanel url={joinUrl} code={tv.code} />
          <p className="mt-4 text-center text-xs uppercase tracking-widest2 text-bone-faint">
            {tv.players.length} / 8 seated · need at least 2 — or seat a house
            bot
          </p>
          <div className="mt-3 flex justify-center">
            <button
              onClick={() => game.actions.addBot()}
              disabled={tv.players.length >= 8}
              className="inline-flex items-center gap-2 rounded-lg border border-bone-faint/30 px-4 py-2 text-xs uppercase tracking-widest2 text-bone-dim transition hover:border-blood hover:text-bone disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Bot size={14} /> Seat a house bot
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }, (_, i) => {
              const p = tv.players[i]
              return (
                <div
                  key={p?.id ?? i}
                  className={cn(
                    'flex aspect-video flex-col items-center justify-center rounded-xl border',
                    p ? 'border-bone-faint/40 bg-white/[0.04]' : 'border-dashed border-bone-faint/15'
                  )}
                >
                  {p ? (
                    <>
                      {p.bot ? (
                        <Bot size={22} className="mb-1.5 text-blood" />
                      ) : (
                        <UserRound size={22} className="mb-1.5 text-hex-light" />
                      )}
                      <span className="max-w-full truncate px-2 font-display text-lg">
                        {p.name}
                      </span>
                      {p.bot ? (
                        <span className="mt-0.5 text-[10px] uppercase tracking-widest2 text-blood">
                          house bot
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <Ghost size={18} className="text-bone-faint/30" />
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-8 grid grid-cols-3 gap-8">
            <Segmented
              label="Night"
              options={['mansion', 'ritual'] as const}
              value={settings.mode}
              onChange={(mode) => setSettings((s) => ({ ...s, mode }))}
              format={(v) => (v === 'mansion' ? 'MANSION' : 'SÉANCE')}
            />
            {isMansion ? (
              <Segmented
                label="Board laps"
                options={LAPS_OPTIONS}
                value={settings.laps}
                onChange={(laps) => setSettings((s) => ({ ...s, laps }))}
              />
            ) : (
              <>
                <Segmented
                  label="Whisper rounds"
                  options={ROUNDS_OPTIONS}
                  value={settings.rounds}
                  onChange={(rounds) => setSettings((s) => ({ ...s, rounds }))}
                />
                <Segmented
                  label="Seconds per round"
                  options={ROUND_OPTIONS}
                  value={settings.roundSeconds}
                  onChange={(roundSeconds) => setSettings((s) => ({ ...s, roundSeconds }))}
                  suffix="s"
                />
              </>
            )}
            {!isMansion ? (
              <Segmented
                label="Vote time"
                options={VOTE_OPTIONS}
                value={settings.voteSeconds}
                onChange={(voteSeconds) => setSettings((s) => ({ ...s, voteSeconds }))}
                suffix="s"
              />
            ) : null}
          </div>

          <ul className="mt-8 space-y-1.5 text-sm leading-relaxed text-bone-dim">
            {howTo.map((line, i) => (
              <li key={i} className="before:mr-2 before:text-blood before:content-['✦']">
                {line}
              </li>
            ))}
          </ul>

          <div className="mt-auto pt-6">
            <button
              disabled={!canStart}
              onClick={() => game.actions.startGame(settings)}
              className="wsp-btn-primary w-full max-w-md !py-5 text-lg tracking-widest disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Play size={20} className="inline" />{' '}
              {isMansion ? 'ENTER THE MANSION' : 'BEGIN THE SÉANCE'}
            </button>
          </div>
        </div>
      </div>
      <ErrorToast game={game} />
    </main>
  )
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  suffix = '',
  format,
}: {
  label: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  suffix?: string
  format?: (v: T) => string
}) {
  return (
    <div>
      <p className="mb-2 text-[0.65rem] uppercase tracking-widest2 text-bone-faint">{label}</p>
      <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-bone-faint/25">
        {options.map((o) => (
          <button
            key={String(o)}
            onClick={() => onChange(o)}
            className={cn(
              'px-4 py-2 font-display text-lg transition-colors',
              value === o ? 'bg-blood/80 text-bone' : 'text-bone-dim hover:bg-white/5'
            )}
          >
            {format ? format(o) : `${o}${suffix}`}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cinematic phases                                                    */
/* ------------------------------------------------------------------ */

/** Reveal lines one by one across the intro window. */
function Intro({ tv }: { tv: TvView }) {
  const elapsed = useTicker(400)
  const idx = Math.min(INTRO_NARRATION.length - 1, Math.floor(elapsed / 3500))
  return (
    <Centered>
      <p className="font-display text-4xl uppercase tracking-widest3 text-bone-faint/70">
        Whistler Lane
      </p>
      <div className="mt-14 h-40" key={idx}>
        <p className="fade-in-slow mx-auto max-w-4xl text-center font-display text-3xl leading-relaxed text-shadow-cine">
          {INTRO_NARRATION[idx]}
        </p>
      </div>
    </Centered>
  )
}

function SecretsCinema() {
  return (
    <Centered>
      <Skull size={44} className="animate-breathe text-hex" />
      <p className="mt-10 max-w-3xl text-center font-display text-4xl leading-snug text-shadow-cine">
        Each phone now holds a secret memory.
      </p>
      <p className="mt-6 text-sm uppercase tracking-widest2 text-bone-faint">
        Read it. Keep it. Do not say it aloud.
      </p>
    </Centered>
  )
}

function WhisperRounds({ tv }: { tv: TvView }) {
  const feed = tv.feed.slice(-6)
  const remainingTotal = tv.settings.roundSeconds * 1000
  return (
    <Centered>
      <p className="font-display text-2xl tracking-widest3 text-blood-bright">
        ROUND {Math.min(tv.round, tv.rounds)} OF {tv.rounds}
      </p>
      <div className="my-10">
        <CountdownRing
          endsAt={tv.phaseEndsAt}
          now={tv.now}
          totalMs={remainingTotal}
          size={300}
          label={PHASE_LABELS.whisper}
        />
      </div>
      <div className="flex items-center justify-center gap-10 text-sm uppercase tracking-widest2 text-bone-dim">
        <span>
          whispers <b className="font-display text-xl normal-case text-bone">{tv.publicStats.whispersDelivered}</b>
        </span>
        <span className="h-4 w-px bg-bone-faint/30" aria-hidden />
        <span>
          dread{' '}
          <span className="ml-1 inline-block h-2 w-28 overflow-hidden rounded-full bg-white/10 align-middle">
            <span
              className="block h-full bg-gradient-to-r from-blood to-blood-bright transition-all duration-700"
              style={{ width: `${Math.min(100, tv.publicStats.dread * 100)}%` }}
            />
          </span>
        </span>
      </div>
      <ul className="mt-10 h-36 w-full max-w-2xl space-y-2 overflow-hidden text-center">
        {feed.map((f, i) => (
          <li
            key={`${f.at}-${i}`}
            className={cn(
              'italic text-bone-dim',
              i === feed.length - 1 ? 'text-bone' : 'opacity-50'
            )}
          >
            ✦ {f.line}
          </li>
        ))}
      </ul>
    </Centered>
  )
}

function OmenCinema({ tv }: { tv: TvView }) {
  return (
    <Centered blood>
      <Flame className="h-16 w-12 animate-glitch text-blood-bright" />
      <p className="mt-12 max-w-4xl text-center font-display text-5xl leading-tight text-shadow-cine">
        {tv.omenLine || 'Something stirs between rounds…'}
      </p>
    </Centered>
  )
}

function VoteCinema({ tv }: { tv: TvView }) {
  return (
    <Centered>
      <p className="font-display text-4xl tracking-widest2 text-shadow-cine">JUDGEMENT</p>
      <div className="my-10">
        <CountdownRing
          endsAt={tv.phaseEndsAt}
          now={tv.now}
          totalMs={tv.settings.voteSeconds * 1000}
          size={260}
          label="cast your votes"
        />
      </div>
      <p className="text-sm uppercase tracking-widest2 text-bone-dim">
        ballots sealed{' '}
        <b className="font-display text-2xl normal-case text-bone">
          {tv.publicStats.votesCast}/{tv.players.length}
        </b>
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        {tv.players.map((p) => (
          <span
            key={p.id}
            className="rounded-full border border-bone-faint/30 px-4 py-2 font-display text-lg"
          >
            {p.name}
          </span>
        ))}
      </div>
    </Centered>
  )
}

function EndingCinema({ tv, game }: { tv: TvView; game: WhisperGame }) {
  const caught = tv.outcome?.verdict === 'silence'
  const reveal = tv.reveal ?? []
  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center px-10 py-12 pb-24">
      <h1
        className={cn(
          'font-display text-6xl tracking-wide text-shadow-cine',
          caught ? 'text-bone' : 'blood-pulse rounded px-4 text-blood-bright'
        )}
      >
        {caught ? 'THE SILENCE' : 'THE HOLLOW WAKES'}
      </h1>
      <p className="mt-4 max-w-2xl text-center italic text-bone-dim">
        {caught
          ? `The table chose true${tv.outcome?.wasTie ? ' — barely' : ''}. ${tv.outcome?.banishedName ?? 'It'} wore the Hollow's voice, and the house exhales.`
          : 'An innocent throat was cut. Somewhere behind you, something begins to hum.'}
      </p>

      <div className="mt-12 grid grid-cols-4 gap-x-10 gap-y-8">
        {(tv.epilogues ?? reveal.map((r) => ({ name: r.name, role: r.role, objectiveDone: null }))).map(
          (e, i) => (
            <div key={i} className="w-52 text-center">
              <div
                className={cn(
                  'card-seal mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full',
                  e.role === 'whisperer' ? '!border-blood-bright' : ''
                )}
              >
                {e.role === 'whisperer' ? (
                  <Skull size={26} className="text-blood-bright" />
                ) : (
                  <UserRound size={24} className="text-hex-light" />
                )}
              </div>
              <p className="font-display text-xl">{e.name}</p>
              <p
                className={cn(
                  'text-xs uppercase tracking-widest2',
                  e.role === 'whisperer' ? 'text-blood-bright' : 'text-bone-faint'
                )}
              >
                {e.role === 'whisperer' ? 'the whisperer' : 'innocent'}
              </p>
              {e.objectiveDone != null ? (
                <p className={cn('mt-1 text-xs', e.objectiveDone ? 'text-moss' : 'text-blood-bright/80')}>
                  {e.role === 'whisperer'
                    ? e.objectiveDone
                      ? 'never unmasked'
                      : 'torn apart'
                    : e.objectiveDone
                      ? 'objective fulfilled'
                      : 'objective failed'}
                </p>
              ) : null}
            </div>
          )
        )}
      </div>

      <div className="mt-auto flex gap-4 pt-10">
        <button
          onClick={() => game.actions.playAgain()}
          className="wsp-btn-primary !px-8 !py-4 tracking-widest"
        >
          <RotateCcw size={18} className="inline" /> ANOTHER NIGHT
        </button>
        <button onClick={() => game.actions.endGame()} className="wsp-btn-ghost !px-6 !py-4 text-sm">
          Close the house
        </button>
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------ */
/* Chrome & helpers                                                    */
/* ------------------------------------------------------------------ */

function HostBar({ game, phase }: { game: WhisperGame; phase: string }) {
  const skippable = phase === 'intro' || phase === 'secrets' || phase === 'omen' || phase === 'vote'
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-between border-t border-bone-faint/10 bg-black/60 px-8 backdrop-blur-md">
      <span className="text-[0.65rem] uppercase tracking-widest2 text-bone-faint/60">
        host controls
      </span>
      <div className="flex gap-3">
        {skippable ? (
          <button onClick={() => game.actions.advance()} className="wsp-btn-ghost !py-2 text-xs">
            Skip ahead →
          </button>
        ) : null}
        {phase !== 'ending' ? (
          <button
            onClick={() => {
              if (window.confirm('Dissolve this house?')) game.actions.endGame()
            }}
            className="wsp-btn-ghost !py-2 text-xs !text-blood-bright/80"
          >
            End night
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Centered({
  children,
  blood = false,
}: {
  children: React.ReactNode
  blood?: boolean
}) {
  return (
    <main
      className={cn(
        'relative z-10 grid min-h-dvh place-items-center px-10',
        blood && 'blood-pulse'
      )}
    >
      {children}
    </main>
  )
}

/** Milliseconds elapsed since this component mounted (mount == phase start). */
function useTicker(intervalMs: number) {
  const start = useRef<number>(Date.now())
  const [, force] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), intervalMs)
    return () => clearInterval(iv)
  }, [intervalMs])
  return Math.max(0, Date.now() - start.current)
}

function useRotating(lines: string[], periodMs: number) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setI((n) => (n + 1) % lines.length), periodMs)
    return () => clearInterval(iv)
  }, [lines.length, periodMs])
  return lines[i % lines.length]
}
