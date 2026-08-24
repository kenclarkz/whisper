/**
 * MANSION — narrative + board content pack (Mario-Party-style mode).
 *
 * Pure data only: the board layout, space effects, items, curses, mystery and
 * horror events, mansion stages and the minigame registry live here so the
 * engine (`engine.js`) stays logic-only. Everything is data-driven: adding a
 * space, curse, item or whole minigame means adding an entry here.
 */

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

/**
 * A single ring of 28 spaces walked by every player. `type` drives what
 * happens on landing; `name` is flavor shown on both screens.
 */
export const BOARD = [
  { name: 'Grand Foyer', type: 'start' },
  { name: 'Gallery', type: 'soul' },
  { name: 'Library', type: 'item' },
  { name: 'Séance Room', type: 'mystery' },
  { name: "Servant's Stair", type: 'shortcut' },
  { name: 'Nursery', type: 'curse' },
  { name: 'Conservatory', type: 'soul' },
  { name: 'Cellar Landing', type: 'horror' },
  { name: 'Study', type: 'item' },
  { name: 'Long Hall', type: 'soul' },
  { name: 'Mirror Chamber', type: 'mystery' },
  { name: 'Chapel', type: 'safe' },
  { name: 'Doll Room', type: 'curse' },
  { name: 'Ballroom', type: 'soul' },
  { name: 'Clock Tower', type: 'shortcut' },
  { name: 'Kitchen', type: 'item' },
  { name: 'Red Bedroom', type: 'horror' },
  { name: 'Crypt Gate', type: 'soul' },
  { name: 'Billiard Room', type: 'mystery' },
  { name: 'Attic Hatch', type: 'curse' },
  { name: 'Winter Garden', type: 'soul' },
  { name: 'Blood Hallway', type: 'horror' },
  { name: 'Music Room', type: 'soul' },
  { name: 'Pantry', type: 'item' },
  { name: 'Well Room', type: 'mystery' },
  { name: 'Iron Door', type: 'safe' },
  { name: 'Portrait Corridor', type: 'curse' },
  { name: 'Threshold', type: 'horror' },
]

export const SPACE_COPY = {
  start: 'The front door locks behind you.',
  soul: 'A cold flame presses a soul into your palm.',
  item: 'Something useful waits in the dust.',
  mystery: 'The house has an offer…',
  curse: 'The air turns heavy. You are marked.',
  horror: 'THE HOUSE MOVES.',
  shortcut: 'A hidden passage swallows you forward.',
  safe: 'Candlelight. Nothing here can touch you.',
}

/** Mansion stage by progress fraction — the house wakes up over time. */
export const STAGES = [
  {
    id: 0,
    name: 'SLUMBERING',
    line: 'The mansion pretends to sleep.',
    tint: '#151019',
  },
  {
    id: 1,
    name: 'RESTLESS',
    line: 'Floorboards remember weight. Doors breathe.',
    tint: '#1a1016',
  },
  {
    id: 2,
    name: 'WAKING',
    line: 'The mansion is awake. It knows your names now.',
    tint: '#210d12',
  },
]

export function stageForProgress(fraction) {
  if (fraction >= 0.67) return 2
  if (fraction >= 0.34) return 1
  return 0
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export const ITEMS = {
  salt_jar: {
    name: 'Salt Jar',
    text: 'A circle of salt. The next harm that finds you simply stops.',
    passive: true, // auto-consumed by the first harm event
  },
  voodoo_doll: {
    name: 'Voodoo Doll',
    text: 'Steal 1 soul from any player.',
    passive: false,
    needsTarget: true,
  },
  black_feather: {
    name: 'Black Feather',
    text: 'Your next roll is never below 4.',
    passive: false,
    needsTarget: false,
  },
  iron_key: {
    name: 'Iron Key',
    text: 'Slip ahead to the nearest Safe Room.',
    passive: false,
    needsTarget: false,
  },
  snuffed_candle: {
    name: 'Snuffed Candle',
    text: 'Choose someone. Half their light in the next minigame.',
    passive: false,
    needsTarget: true,
  },
}
export const ITEM_IDS = Object.keys(ITEMS)

/* ------------------------------------------------------------------ */
/* Curses                                                              */
/* ------------------------------------------------------------------ */

export const CURSES = {
  heavy_boots: {
    name: 'Heavy Boots',
    text: 'Your next roll moves you one less.',
    /** Applied to roll result in rollDice(). */
    apply: 'roll_minus_1',
  },
  dim_eyes: {
    name: 'Dim Eyes',
    text: 'Half souls from your next minigame.',
    apply: 'reward_half',
  },
  marked: {
    name: 'Marked',
    text: 'The next horror event chooses YOU.',
    apply: 'horror_target',
  },
  greedy_pockets: {
    name: 'Greedy Pockets',
    text: 'One less soul from every prize.',
    apply: 'reward_minus_1',
  },
}
export const CURSE_IDS = Object.keys(CURSES)

/* ------------------------------------------------------------------ */
/* Mystery outcomes (weighted pick on landing)                         */
/* ------------------------------------------------------------------ */

export const MYSTERIES = [
  {
    id: 'kind_flame',
    line: 'A kind flame. +1 soul.',
    effect: { souls: +1 },
    weight: 3,
  },
  {
    id: 'forward_pull',
    line: 'The floor tilts forward. Move 3 more.',
    effect: { move: 3 },
    weight: 2,
  },
  {
    id: 'trapdoor',
    line: 'A trapdoor! Back 4 spaces.',
    effect: { move: -4 },
    weight: 2,
  },
  {
    id: 'tithe',
    line: 'Everyone tithes you a memory. +1 soul from each other player who has one.',
    effect: { collect: 1 },
    weight: 2,
  },
  {
    id: 'swap',
    line: 'The house trades places with another guest.',
    effect: { swap_random: true },
    weight: 2,
  },
  {
    id: 'gift_item',
    line: 'A gift wrapped in hair. Draw an item.',
    effect: { item: true },
    weight: 2,
  },
  {
    id: 'nothing',
    line: 'Just dust, and the feeling of being counted.',
    effect: {},
    weight: 3,
  },
]

/* ------------------------------------------------------------------ */
/* Horror events — severity scales with the mansion stage              */
/* ------------------------------------------------------------------ */

export const HORROR_EVENTS = [
  {
    id: 'whispered_name',
    stages: [0, 1, 2],
    line: 'Something whispers your name from inside the wall.',
    effect: { scare: true },
  },
  {
    id: 'cold_sweep',
    stages: [1, 2],
    line: 'Cold sweeps the hall. Everyone rolls — lowest loses 1 soul.',
    effect: { contest_roll_low_loses: 1 },
  },
  {
    id: 'the_taking',
    stages: [2],
    line: 'THE TAKING. The house chooses. It keeps what it catches.',
    effect: { kill_marked_or_random: true },
  },
  {
    id: 'drain',
    stages: [1, 2],
    line: 'Your shadow is wrung out like cloth. Lose 1 soul.',
    effect: { lose_souls_target: 1 },
  },
]

/* ------------------------------------------------------------------ */
/* Minigame registry                                                   */
/* ------------------------------------------------------------------ */

/**
 * Data-driven registry. `kind` selects the runtime in minigames.js;
 * everything else is presentation copy + tuning the clients share.
 */
export const MINIGAMES = {
  candle: {
    id: 'candle',
    kind: 'taps',
    name: 'KEEP THE CANDLE ALIVE',
    tagline: 'TAP. Do not let it gutter out.',
    controlsHint: 'Tap as fast as you can',
    durationMs: 12000,
    icon: 'flame',
  },
  chase: {
    id: 'chase',
    kind: 'lanes',
    name: 'ESCAPE THE MONSTER',
    tagline: 'HOLD to run. Watch your breath.',
    controlsHint: 'Hold RUN — release to catch your breath',
    durationMs: 16000,
    icon: 'footprints',
  },
  dontlook: {
    id: 'dontlook',
    kind: 'gated_taps',
    name: "DON'T LOOK",
    tagline: 'Tap while its eye is shut. Freeze when it opens.',
    controlsHint: 'Tap when dark — never when the eye opens',
    durationMs: 20000,
    icon: 'eye',
  },
  sacrifice: {
    id: 'sacrifice',
    kind: 'secret_vote',
    name: 'SACRIFICE',
    tagline: 'The altar demands a name.',
    controlsHint: 'Secretly choose who the house takes from',
    durationMs: 15000,
    icon: 'skull',
  },
  maze: {
    id: 'maze',
    kind: 'grid',
    name: 'HAUNTED MAZE',
    tagline: 'Find the way out before it finds you.',
    controlsHint: 'D-pad to move. First one out wins.',
    durationMs: 30000,
    icon: 'map',
  },
}
export const MINIGAME_IDS = Object.keys(MINIGAMES)

/** Souls awarded by final rank in ranked minigames. */
export const RANK_REWARDS = [3, 2, 1]

/** How often a minigame fires: after every N completed turns. */
export const MINIGAME_EVERY_TURNS = 4

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

export const MATCH_TUNING = {
  turnIdleMs: 20000, // auto-roll for AFK players
  stepMs: 420, // movement animation beat between spaces
  hauntWindowMs: 8000, // time a ghost has to choose a haunt target
  minigameIntroMs: 5000,
  minigameResultsMs: 7000,
  contestGraceMs: 4000, // window to resolve horror contests
  maxSoulsClamp: 99,
}
