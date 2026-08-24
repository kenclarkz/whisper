'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * Join-QR for the shared screen. Encodes the mobile join URL with the room
 * code pre-filled so players just add a name and tap once.
 */
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
