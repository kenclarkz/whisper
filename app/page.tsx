'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MonitorPlay, Radio } from 'lucide-react'
import { JoinForm } from '@/components/JoinForm'
import { Atmosphere } from '@/components/Atmosphere'
import { loadSession } from '@/lib/whisper/session'

export default function JoinPage() {
  const router = useRouter()
  const [warmSeat, setWarmSeat] = useState<{ code: string; name: string } | null>(null)

  useEffect(() => {
    const s = loadSession()
    if (s?.kind === 'player') setWarmSeat({ code: s.code, name: s.name })
  }, [])

  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 py-14">
      <Atmosphere />

      <h1 className="font-display text-6xl tracking-[0.22em] text-shadow-cine">WHISPER</h1>
      <p className="mt-3 max-w-xs text-center text-sm italic leading-relaxed text-bone-faint">
        A parlour game of secrets, spoken once.
      </p>

      <div className="mt-12 w-full max-w-sm">
        {warmSeat ? (
          <>
            <p className="mb-4 text-center text-xs uppercase tracking-widest2 text-hex-light">
              You left a seat warm in {warmSeat.code}
            </p>
            <button
              onClick={() => router.push('/play/')}
              className="wsp-btn-primary mb-4 w-full"
            >
              <Radio size={18} className="inline" /> Return to your seat
            </button>
            <div className="mb-8 flex items-center gap-3 text-bone-faint/40">
              <span className="h-px flex-1 bg-current" />
              <span className="text-[0.65rem] uppercase tracking-widest2">or join anew</span>
              <span className="h-px flex-1 bg-current" />
            </div>
          </>
        ) : null}

        <JoinForm
          onJoin={(code, name) => {
            router.push(
              `/play/?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`
            )
          }}
        />

        <Link
          href="/tv/"
          className="mx-auto mt-10 flex w-fit items-center gap-2 text-xs uppercase tracking-widest2 text-bone-faint/70 hover:text-bone-dim"
        >
          <MonitorPlay size={14} /> I am the television
        </Link>
      </div>
    </main>
  )
}
