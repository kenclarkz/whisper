/**
 * WHISPER — narrative content pack.
 *
 * All secrets, bait words, omens and narration used by the game. Kept as pure
 * data so the state machine (`state.js`) stays logic-only and easy to test.
 */

export const LIMITS = {
  minPlayers: 3,
  maxPlayers: 8,
  nameMin: 1,
  nameMax: 14,
  whisperMaxChars: 400,
}

/** Room codes avoid visually ambiguous characters (no I, O, 0, 1). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Single evocative words innocents must bait out of each other. */
export const BAIT_WORDS = [
  'MIRROR', 'SALT', 'CANDLE', 'BASEMENT', 'ATTIC', 'DOLL', 'FUNERAL', 'RIVER',
  'SCAR', 'LULLABY', 'SHADOW', 'DOOR', 'TEETH', 'ORCHARD', 'WELL', 'ASH',
  'BELL', 'PORTRAIT', 'WEDDING', 'HOLLOW', 'MOTH', 'KEYHOLE', 'CRADLE',
  'THORN', 'LANTERN', 'CELLAR', 'FEATHER', 'GARDEN', 'WINTER', 'SMOKE',
]

/**
 * Memory fragments — one unique secret per innocent player.
 * `%WORD%` is replaced with the player's personal bait word so the secret
 * always rhymes with their objective.
 */
export const SECRETS = [
  'On the night of the storm, you buried something behind the pantry and never told anyone why.',
  'You still hear your mother counting to nine in the dark. She stopped at nine because someone answered.',
  'There is a photograph of this house in your drawer. You are standing in the window. You have never visited it before tonight.',
  'The last time you saw your brother, he whispered "%WORD%" and walked into the lake.',
  'You found a door in your childhood home that does not exist on any floor plan. It was warm.',
  'You promised the thing in the well that you would come back before winter. Winter was eleven years ago.',
  'Every mirror you have owned cracked on the same date. Tonight is that date.',
  'As a child, you taught something to speak. It still calls you by a name no one else uses.',
  'You woke once at 3:33 AM to find every clock running backwards, and a wet handprint on your window — on the second floor.',
  'Your grandmother sewed a name into your coat when you were small. It is not your name.',
  'You have a scar shaped like a keyhole. When it rains, you dream of turning.',
  'The doll you buried as a child was never yours to bury. Someone has been leaving flowers on its grave.',
  "You counted the guests at your father's funeral. There was one more person than invitations — and everyone else remembers them too.",
  'You once followed humming through the orchard until the trees ended mid-row, like a stage set. Something hummed behind you after that.',
  'A stranger paid you to keep a room locked for one year. Six months remain. The knocking started last week.',
  'You know the words that make the candle gutter. You swore never to say them indoors again.',
]

/** Objective templates for innocents. `payload` is filled per-player. */
export const OBJECTIVES = {
  bait: {
    label: 'THE BAIT',
    text: (p) => `Trick any player into whispering you the word "${p.word}".`,
    hint: 'Ask leading questions. Make them say it first.',
  },
  listeners: {
    label: 'THE EAR',
    text: (p) => `Receive whispers from ${p.count} different players.`,
    hint: 'Make yourself safe to confess to.',
  },
  silence: {
    label: 'THE VOW',
    text: (p) => `Send no whispers during round ${p.round}.`,
    hint: 'Listen only. Let them wonder about you.',
  },
}

/** Lines whispered between whisper rounds (server picks one per omen phase). */
export const OMENS = [
  'Something upstairs is walking. Bare feet. Slowly.',
  'The candles lean toward one of you. Only one.',
  'A breath on the back of your neck counts your heartbeats.',
  'Somewhere, a music box plays a song you almost remember.',
  'The walls sweat cold. The house is listening closer now.',
  'One of the portraits has turned to face the table.',
  'Dust falls from the ceiling in the shape of fingers.',
  'The front door was open. Now it is not.',
]

/** Ending copy keyed by verdict. */
export const ENDINGS = {
  silence: {
    title: 'THE SILENCE',
    line: 'The chosen one opens their mouth — and moths pour out. The house exhales. The whispering stops. You cut out its tongue.',
  },
  hollow: {
    title: 'THE HOLLOW WAKES',
    line: 'The accused was innocent. Around the table, throats open — but the voice that comes out belongs to none of you. The Hollow keeps its choir.',
  },
}
