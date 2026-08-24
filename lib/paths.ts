/**
 * Optional base path (e.g. hosting the static export under /whisper on a
 * shared domain). Empty by default — the game server serves everything at root.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '')

export function asset(path: string): string {
  if (!path) return path
  const clean = path.startsWith('/') ? path : `/${path}`
  return clean.startsWith(BASE_PATH) ? clean : `${BASE_PATH}${clean}`
}
