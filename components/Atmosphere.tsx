'use client'

import { useEffect, useMemo, useState } from 'react'

/** Fixed atmosphere layers: vignette + slow drifting motes. */
export function Atmosphere({ motes = 14 }: { motes?: number }) {
  const seeds = useMemo(
    () =>
      Array.from({ length: motes }, (_, i) => ({
        left: (i * 71 + 13) % 100,
        delay: (i * 1.37) % 7,
        size: 2 + ((i * 7) % 3),
        dur: 6 + ((i * 11) % 5),
      })),
    [motes]
  )
  return (
    <>
      <div className="vignette fixed inset-0 z-[60]" aria-hidden />
      <div className="pointer-events-none fixed inset-0 z-[55] overflow-hidden" aria-hidden>
        {seeds.map((s, i) => (
          <span
            key={i}
            className="absolute bottom-0 rounded-full bg-bone/25 blur-[1px] animate-drift-up"
            style={{
              left: `${s.left}%`,
              width: s.size,
              height: s.size,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.dur}s`,
            }}
          />
        ))}
      </div>
    </>
  )
}

/** Small flame/candle glyph. */
export function Flame({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 32" className={className} aria-hidden>
      <path
        d="M12 1C9 8 4 10.5 4 17a8 8 0 0016 0c0-4.5-3-6.5-4.5-9.5C14.5 10 13 11 12 13c-.8-4 .5-8 0-12z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Connection status dot (phone + TV chrome). */
export function ConnDot({
  state,
}: {
  state: 'idle' | 'connecting' | 'open' | 'closed' | 'error'
}) {
  const color =
    state === 'open'
      ? 'bg-moss'
      : state === 'connecting'
        ? 'bg-hex-light animate-breathe'
        : state === 'idle'
          ? 'bg-bone-faint/50'
          : 'bg-blood-bright'
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-label={state} />
}

interface CountdownProps {
  endsAt: number | null
  now: number
  totalMs: number
  size?: number
  label?: string
}

/** Cinematic countdown ring for the shared screen. */
export function CountdownRing({ endsAt, now, totalMs, size = 260, label }: CountdownProps) {
  const remaining = useRemaining(endsAt, now)
  const frac = Math.max(0, Math.min(1, remaining / Math.max(1, totalMs)))
  const r = size / 2 - 14
  const c = 2 * Math.PI * r
  const secs = Math.ceil(remaining / 1000)
  const urgent = remaining < 11000 && remaining > 0

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" className="ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className={`ring-fill ${urgent ? 'animate-breathe' : ''}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-display font-bold tabular-nums text-shadow-cine ${
            urgent ? 'text-blood-bright' : 'text-bone'
          }`}
          style={{ fontSize: size * 0.24 }}
        >
          {secs}
        </span>
        {label ? (
          <span className="mt-1 uppercase tracking-widest2 text-bone-dim text-sm">{label}</span>
        ) : null}
      </div>
    </div>
  )
}

/** Slim countdown bar for phone screens. */
export function CountdownBar({ endsAt, now, totalMs }: Omit<CountdownProps, 'size'>) {
  const remaining = useRemaining(endsAt, now)
  const frac = Math.max(0, Math.min(1, remaining / Math.max(1, totalMs)))
  const urgent = remaining < 11000 && remaining > 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
      <div
        className={`h-full rounded-full transition-[width] duration-300 linear ${
          urgent ? 'bg-blood-bright' : 'bg-blood'
        }`}
        style={{ width: `${frac * 100}%` }}
      />
    </div>
  )
}

function useRemaining(endsAt: number | null, serverNow: number) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 250)
    return () => clearInterval(iv)
  }, [])
  void tick
  if (!endsAt) return 0
  // Trust the server clock, corrected by observed skew.
  const skew = Date.now() - serverNow
  return Math.max(0, endsAt - Date.now() - Math.max(0, skew))
}
