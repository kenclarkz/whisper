/** Client-side presentation copy (gameplay truth lives on the server). */

export const INTRO_NARRATION = [
  'The house on Whistler Lane has been empty for thirty years.',
  'Tonight, its chairs are warm again.',
  'It is said the dead here do not shout. They whisper.',
  'And one of you… whispers for it.',
]

export const LOBBY_WHISPERS = [
  'The table is set…',
  'Candles find their wicks…',
  'Something counts the chairs…',
]

export const PHASE_LABELS: Record<string, string> = {
  lobby: 'THE GATHERING',
  intro: 'WHISTLER LANE',
  secrets: 'MEMORIES SURFACE',
  whisper: 'THE WHISPERING',
  omen: 'AN OMEN',
  vote: 'JUDGEMENT',
  ending: 'WHAT REMAINED',
}

export const HOW_TO_PLAY = [
  'One screen is the house. Everyone else plays from their phone.',
  'Each phone receives a secret memory — all different.',
  'Select a player, hold the mic, and your words go ONLY to them.',
  'One of you whispers for the Hollow. It hears everything.',
  'When time ends, vote. Banish the Whisperer — or feed it.',
]
