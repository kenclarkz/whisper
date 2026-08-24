import type { Metadata, Viewport } from 'next'
import { Cinzel, Jost } from 'next/font/google'
import './globals.css'

const cinzel = Cinzel({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-display',
  display: 'swap',
})

const jost = Jost({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'WHISPER — a multiplayer horror ritual',
    template: '%s — WHISPER',
  },
  description:
    'One shared screen becomes the house. Everyone else plays from their phone. Whisper your secrets carefully — one of you whispers for it.',
  robots: { index: false },
}

export const viewport: Viewport = {
  themeColor: '#070508',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`bg-void ${cinzel.variable} ${jost.variable}`}>
      <body>
        <div className="grain-heavy fixed inset-0 z-[70]" aria-hidden />
        {children}
      </body>
    </html>
  )
}
