/**
 * Built-in pixel art creature definitions.
 *
 * GRID FORMAT
 * -----------
 * Each creature animation state has an array of frames.
 * Each frame is an array of strings — one string per row.
 * Each character maps to a color via `palette`.
 * '.' (dot) = fully transparent — skip rendering.
 * All rows must be the same length.
 *
 * PALETTE CHARACTERS (per creature, customisable)
 * ------------------------------------------------
 * B = body       D = dark shadow   L = light highlight
 * W = white      P = pupil (dark)  M = mouth
 * Z = zzz text   R = red           Y = yellow/glow
 * O = open mouth
 *
 * ADD YOUR OWN
 * ------------
 * See assets/sprites/README.md for the PNG-based sprite format.
 * To add a code-defined creature, duplicate the EGG export below,
 * give it a new id, design your grid frames, and add it to
 * BUILTIN_CREATURES at the bottom of this file.
 */

export interface CreatureFrame {
  grid: string[]
  palette: Record<string, number> // char → 0xRRGGBB (alpha always 0xff)
}

export interface CreatureAnimation {
  frames: CreatureFrame[]
  fps: number
}

export type CreatureStateName = 'idle' | 'busy' | 'sleep' | 'error' | 'talking' | 'egg' | 'hatching'

export interface CreatureDefinition {
  id: string
  displayName: string
  /** Pixel scale — each grid cell renders as scale×scale screen pixels */
  scale: number
  animations: Partial<Record<CreatureStateName, CreatureAnimation>> & { idle: CreatureAnimation }
}

// ---------------------------------------------------------------------------
// EGG — a cream-coloured egg that bobs, then cracks when hatching (12×12 @ 3×)
// ---------------------------------------------------------------------------

const EGG_PALETTE: Record<string, number> = {
  E: 0xfff5cc, // eggshell cream
  H: 0xffffff, // highlight
  S: 0xddc898, // shadow/underside
  C: 0x8b5e10, // crack line (dark brown)
  K: 0xffff55, // sparkle yellow
  G: 0xaaffaa  // green sparkle accent
}

// egg idle — slight highlight shift between frames to suggest bobbing
const EGG_IDLE_0: string[] = [
  '....EEEE....',
  '...EEHEEE...',
  '..EEHEHEEE..',
  '..EEEEEEEE..',
  '..EEEEEEEE..',
  '..EEEEEEEE..',
  '..EEEEEEEE..',
  '..EESSSSEE..',
  '...ESSSSSE..',
  '....SSSS....',
  '............',
  '............'
]

const EGG_IDLE_1: string[] = [
  '....EEEE....',
  '...EEEEHE...',
  '..EEEHEEEE..',
  '..EEEEEEEE..',
  '..EEEEEEEE..',
  '..EEEEEEEE..',
  '..EEEEEEEE..',
  '..EESSSSEE..',
  '...ESSSSSE..',
  '....SSSS....',
  '............',
  '............'
]

// hatching — crack appears, sparkles fly
const EGG_HATCH_0: string[] = [
  '....EEEE....',
  '...EEHEEE...',
  '..EECEEEE...',  // crack starts
  '..ECEEEEEE..',
  '..ECEEEEEE..',
  '..EEEEEEEE..',
  '..EEEEEEEE..',
  '..EESSSSEE..',
  '...ESSSSSE..',
  '....SSSS....',
  '...K......K.',
  '..........K.'
]

const EGG_HATCH_1: string[] = [
  '....EEEE....',
  '...EECEE....',  // top crack
  '..ECCEEEE...',
  '..ECEECEEE..',
  '..EECEEECE..',
  '..EEECEEE...',
  '..EEEEEEEE..',
  '..EESSSSEE..',
  '...ESSSSSE..',
  '....SSSS....',
  '.K.....K.G..',
  '....K.......'
]

function eggFrame(grid: string[]): CreatureFrame {
  return { grid, palette: EGG_PALETTE }
}

export const EGG: CreatureDefinition = {
  id: 'egg',
  displayName: 'Egg',
  scale: 3,
  animations: {
    idle:     { fps: 1,   frames: [eggFrame(EGG_IDLE_0),  eggFrame(EGG_IDLE_1)]  },
    egg:      { fps: 1,   frames: [eggFrame(EGG_IDLE_0),  eggFrame(EGG_IDLE_1)]  },
    hatching: { fps: 4,   frames: [eggFrame(EGG_HATCH_0), eggFrame(EGG_HATCH_1)] },
    // Fallbacks for states that shouldn't normally apply to an egg:
    busy:     { fps: 2,   frames: [eggFrame(EGG_IDLE_0)]  },
    sleep:    { fps: 0.5, frames: [eggFrame(EGG_IDLE_0)]  },
    error:    { fps: 4,   frames: [eggFrame(EGG_HATCH_0)] },
    talking:  { fps: 3,   frames: [eggFrame(EGG_IDLE_0),  eggFrame(EGG_IDLE_1)]  }
  }
}

// ---------------------------------------------------------------------------
// Registry — add new code-defined creatures here
// ---------------------------------------------------------------------------
export const BUILTIN_CREATURES: CreatureDefinition[] = []
export const EGG_CREATURE: CreatureDefinition = EGG
