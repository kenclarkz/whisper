import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

/** Server/client clock offset helper — views carry `now`. */
export function remainingMs(phaseEndsAt: number | null, serverNow: number): number {
  if (!phaseEndsAt) return 0
  const skew = Date.now() - serverNow
  return Math.max(0, phaseEndsAt - Date.now() + Math.min(skew, 0))
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
