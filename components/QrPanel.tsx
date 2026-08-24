'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * Join-QR for the shared screen. Encodes the mobile join URL with the room
 * code pre-filled so players just add a name and tap once.
 */
function isLocalhost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  } catch {
    return false
  }
}
export function QrPanel({ url, code }: { url: string; code: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(url, {
      margin: 1,
      width: 480,
      errorCorrectionLevel: 'M',
      color: { dark: '#E8E0D0', light: '#0D0A0F' },
    })
      .then((d) => {
        if (!cancelled) setDataUrl(d)
      })
      .catch(() => {
        /* leave placeholder */
      })
    return () => {
      cancelled = true
    }
  }, [url])

  return (
    <div className="card-seal rounded-2xl p-5 text-center">
      <div className="mx-auto aspect-square w-44 overflow-hidden rounded-xl border border-bone-faint/30 bg-crypt">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt={`Scan to join room ${code}`} className="h-full w-full" />
        ) : (
          <div className="flex h-full items-center justify-center font-display text-3xl text-bone-dim">
            {code}
          </div>
        )}
      </div>
      <p className="mt-4 text-xs uppercase tracking-widest2 text-bone-dim">
        Scan — or open
      </p>
      <p className="mt-1 break-all font-sans text-xs text-hex-light">{url}</p>
      {isLocalhost(url) ? (
        <p className="mt-3 rounded-lg border border-blood/50 bg-blood-dark/40 px-3 py-2 text-[0.7rem] leading-relaxed text-blood-bright">
          Phones can&apos;t open “localhost”. Open this screen via this
          computer&apos;s network address instead — e.g.
          <span className="mx-1 font-sans">
            http://&lt;your-ip&gt;:{typeof window === 'undefined' ? '' : window.location.port}
          </span>
          — then rescan.
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-center gap-2" aria-hidden>
        {code.split('').map((ch, i) => (
          <span
            key={i}
            className="rounded bg-black/50 px-2.5 py-1 font-display text-xl font-bold tracking-widest text-bone"
          >
            {ch}
          </span>
        ))}
      </div>
    </div>
  )
}
