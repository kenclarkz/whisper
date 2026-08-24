/** Client-side MANSION presentation data: board geometry, copy, helpers. */
import type { SpaceType } from '@/lib/whisper/protocol'

/* ------------------------------------------------------------------ */
/* Board geometry                                                      */
/* ------------------------------------------------------------------ */

/**
 * The 28 spaces are laid out as the perimeter of a 9×7 grid, walked
 * clockwise from the top-left corner. Pure presentation math.
 */
export const BOARD_COLS = 9
export const BOARD_ROWS = 7
export const BOARD_SIZE = 28

export function cellForIndex(i: number): { col: number; row: number } {
  const top = BOARD_COLS // 9
  const right = BOARD_ROWS - 1 // 6
  const bottom = BOARD_COLS - 1 // 8
  if (i < top) return { col: i, row: 0 }
  if (i < top + right) return { col: BOARD_COLS - 1, row: i - top + 1 }
  if (i < top + right + bottom) return { col: BOARD_COLS - 2 - (i - top - right), row: BOARD_ROWS - 1 }
  return { col: 0, row: BOARD_ROWS - 2 - (i - top - right - bottom) }
}

/** Percent position inside the board box (with padding so tokens fit). */
export function percentForIndex(i: number): { x: number; y: number } {
  const { col, row } = cellForIndex(i)
  const padX = 5.5
  const padY = 8
  const x = padX + (col / (BOARD_COLS - 1)) * (100 - padX * 2)
  const y = padY + (row / (BOARD_ROWS - 1)) * (100 - padY * 2)
  return { x, y }
}

export const SPACE_TYPE_META: Record<
  SpaceType,
  { label: string; glyph: string; accent: string }
> = {
  start: { label: 'Foyer', glyph: '⌂', accent: '#5C564A' },
  soul: { label: 'Soul', glyph: '✦', accent: '#A79BC0' },
  item: { label: 'Item', glyph: '✚', accent: '#5F7355' },
  mystery: { label: 'Mystery', glyph: '?', accent: '#7A6A8F' },
  curse: { label: 'Curse', glyph: '☠', accent: '#E0342C' },
  horror: { label: 'Horror', glyph: '▲', accent: '#A31621' },
  shortcut: { label: 'Shortcut', glyph: '»', accent: '#C9A227' },
  safe: { label: 'Safe Room', glyph: '○', accent: '#E8E0D0' },
}

/* ------------------------------------------------------------------ */
/* Items & curses — mirrors server/src/mansion/content.js              */
/* ------------------------------------------------------------------ */

export const ITEM_META: Record<string, { name: string; text: string }> = {
  salt_jar: {
    name: 'Salt Jar',
    text: 'Wards off the next harm automatically.',
  },
  voodoo_doll: {
    name: 'Voodoo Doll',
    text: 'Steal 1 soul from any player.',
  },
  black_feather: {
    name: 'Black Feather',
    text: 'Your next roll is never below 4.',
  },
  iron_key: {
    name: 'Iron Key',
    text: 'Skip ahead to the nearest Safe Room.',
  },
  snuffed_candle: {
    name: 'Snuffed Candle',
    text: 'Halve someone’s next minigame reward.',
  },
}

export const CURSE_META: Record<string, { name: string; text: string }> = {
  heavy_boots: { name: 'Heavy Boots', text: 'Next roll −1.' },
  dim_eyes: { name: 'Dim Eyes', text: 'Half souls next minigame.' },
  marked: { name: 'Marked', text: 'Next horror event chooses you.' },
  greedy_pockets: { name: 'Greedy Pockets', text: '−1 soul from prizes.' },
}

/* ------------------------------------------------------------------ */
/* Mansion stages                                                      */
/* ------------------------------------------------------------------ */

export const STAGE_META = [
  {
    name: 'SLUMBERING',
    line: 'The mansion pretends to sleep.',
    fogOpacity: 0.05,
    glowStrength: 0.35,
  },
  {
    name: 'RESTLESS',
    line: 'Floorboards remember weight.',
    fogOpacity: 0.11,
    glowStrength: 0.6,
  },
  {
    name: 'WAKING',
    line: 'It knows your names now.',
    fogOpacity: 0.18,
    glowStrength: 1,
  },
] as const
