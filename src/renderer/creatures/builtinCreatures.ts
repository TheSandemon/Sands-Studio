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
 * To add a code-defined creature, duplicate the BLOB export below,
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
// BLOB — a friendly cornflower-blue blob, 12×12 grid @ 3× scale = 36×36 px
// ---------------------------------------------------------------------------

const BLOB_PALETTE: Record<string, number> = {
  B: 0x5b90f0, // body blue
  L: 0x9abfff, // light highlight
  D: 0x2a55aa, // dark shadow
  W: 0xffffff, // white (eyes)
  P: 0x111133, // pupil
  M: 0xffaaaa, // mouth pink
  Z: 0xffff99, // zzz yellow
  R: 0xff4455, // red (error)
  Y: 0xffdd55, // yellow glow (excited)
  O: 0xff8844  // orange (open mouth)
}

// idle — eyes open / blink cycle
const BLOB_IDLE_0: string[] = [
  '....BBBB....',
  '...BBBBBB...',
  '..BBLLLLBB..',
  '..BBBBBBBB..',
  '..BWWBBWWB..',
  '..BWPBBWPB..',
  '..BBBBBBBB..',
  '..BBMMMMBB..',
  '...BBBBBB...',
  '....BBBB....',
  '............',
  '............'
]

const BLOB_IDLE_1: string[] = [
  '....BBBB....',
  '...BBBBBB...',
  '..BBLLLLBB..',
  '..BBBBBBBB..',
  '..BDDBBDDB..',  // blink — eyes closed
  '..BBBBBBBB..',
  '..BBBBBBBB..',
  '..BBMMMMBB..',
  '...BBBBBB...',
  '....BBBB....',
  '............',
  '............'
]

// busy — arms up / arms out, bright excited eyes
const BLOB_BUSY_0: string[] = [
  '.B..BBBB..B.',
  'BB.BBBBBB.BB',
  '..BBLLLLBB..',
  '..BBBBBBBB..',
  '..BYWBBYWB..',  // Y = yellow glow in eyes
  '..BWPBBWPB..',
  '..BBBBBBBB..',
  '..BBMMMMBB..',
  '...BBBBBB...',
  '....BBBB....',
  '............',
  '............'
]

const BLOB_BUSY_1: string[] = [
  '....BBBB....',
  '.BBBBBBBBBB.',
  '..BBLLLLBB..',
  '..BBBBBBBB..',
  '..BYWBBYWB..',
  '..BWPBBWPB..',
  '..BBBBBBBB..',
  '..BBMMMMBB..',
  '...BBBBBB...',
  '....BBBB....',
  '.B........B.',
  'BB........BB'
]

// sleep — eyes shut, Zzz floats above
const BLOB_SLEEP_0: string[] = [
  '....BBBB....',
  '...BBBBBB...',
  '..BBLLLLBB..',
  '..BBBBBBBB..',
  '..BDDBBDDB..',
  '..BBBBBBBB..',
  '..BBBBBBBB..',
  '..BBBBBBBB..',
  '...BBBBBB...',
  '....BBBB....',
  '.......Z....',
  '......ZZ....'
]

const BLOB_SLEEP_1: string[] = [
  '....BBBB....',
  '...BBBBBB...',
  '..BBLLLLBB..',
  '..BBBBBBBB..',
  '..BDDBBDDB..',
  '..BBBBBBBB..',
  '..BBBBBBBB..',
  '..BBBBBBBB..',
  '...BBBBBB...',
  '....BBBB....',
  '.....ZZZ....',
  '....ZZZZ....'
]

// error — X eyes, frown, body flashes red
const BLOB_ERROR_0: string[] = [
  '....BBBB....',
  '...BBBBBB...',
  '..BBLLLLBB..',
  '..BBRRRRBB..',
  '..BRRBBRRB..',  // X eyes
  '..BRRBBRRB..',
  '..BBBBBBBB..',
  '..BBDDDDBB..',  // sad frown
  '...BBBBBB...',
  '....BBBB....',
  '............',
  '............'
]

const BLOB_ERROR_1: string[] = [
  '....RRRR....',
  '...RBBBBR...',
  '..RBBLLBBR..',
  '..RBBBBBBR..',
  '..RRRBBRRR..',
  '..RRRBBRRR..',
  '..RBBBBBBR..',
  '..RBBDDBBR..',
  '...RBBBBR...',
  '....RRRR....',
  '............',
  '............'
]

// talking — open mouth alternates with closed, bright eyes
const BLOB_TALKING_0: string[] = [
  '....BBBB....',
  '...BBBBBB...',
  '..BBLLLLBB..',
  '..BBBBBBBB..',
  '..BYWBBYWB..',
  '..BWPBBWPB..',
  '..BBBBBBBB..',
  '..BBOOOOBB..',  // open mouth
  '...BBBBBB...',
  '....BBBB....',
  '............',
  '............'
]

const BLOB_TALKING_1: string[] = [
  '....BBBB....',
  '...BBBBBB...',
  '..BBLLLLBB..',
  '..BBBBBBBB..',
  '..BYWBBYWB..',
  '..BWPBBWPB..',
  '..BBBBBBBB..',
  '..BBMMMMBB..',  // closed mouth
  '...BBBBBB...',
  '....BBBB....',
  '............',
  '............'
]

function frame(grid: string[]): CreatureFrame {
  return { grid, palette: BLOB_PALETTE }
}

export const BLOB: CreatureDefinition = {
  id: 'blob',
  displayName: 'Blob',
  scale: 3,
  animations: {
    idle:    { fps: 1.5, frames: [frame(BLOB_IDLE_0),    frame(BLOB_IDLE_1)]    },
    busy:    { fps: 6,   frames: [frame(BLOB_BUSY_0),    frame(BLOB_BUSY_1)]    },
    sleep:   { fps: 0.8, frames: [frame(BLOB_SLEEP_0),   frame(BLOB_SLEEP_1)]   },
    error:   { fps: 4,   frames: [frame(BLOB_ERROR_0),   frame(BLOB_ERROR_1)]   },
    talking: { fps: 8,   frames: [frame(BLOB_TALKING_0), frame(BLOB_TALKING_1)] }
  }
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
export const BUILTIN_CREATURES: CreatureDefinition[] = [BLOB]
export const EGG_CREATURE: CreatureDefinition = EGG
