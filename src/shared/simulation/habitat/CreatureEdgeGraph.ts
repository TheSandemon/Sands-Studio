/**
 * CreatureEdgeGraph — behavior edges for creatures.
 *
 * Each edge represents a state transition driven by a condition.
 * The graph is data (JSON-serializable) while conditions are code.
 *
 * The 'default' graph covers basic needs: hunger, energy, wandering, eating, sleeping.
 * Creature types can add extra edges (e.g. hunting for bats).
 */
import type { Edge, EvalContext, StateVector } from '../types.js';
import type { CreatureState } from './CreatureState.js';

export type CreatureEdge = Edge<CreatureState>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function isIdle(s: CreatureState): boolean {
  return s.currentNodeId === 'idle';
}
function isWandering(s: CreatureState): boolean {
  return s.currentNodeId === 'wandering';
}
function isSeekingFood(s: CreatureState): boolean {
  return s.currentNodeId === 'seeking_food';
}
function isEating(s: CreatureState): boolean {
  return s.currentNodeId === 'eating';
}
function isSleeping(s: CreatureState): boolean {
  return s.currentNodeId === 'sleeping';
}
function isHunting(s: CreatureState): boolean {
  return s.currentNodeId === 'hunting';
}
function isDead(s: CreatureState): boolean {
  return s.hp <= 0;
}

function hungerHigh(s: CreatureState): boolean {
  return s.hunger > s.hungerThreshold;
}

function hungerCritical(s: CreatureState): boolean {
  return s.hunger > 90;
}

function hungerLow(s: CreatureState): boolean {
  return s.hunger < s.hungerThreshold;
}

function hungerFull(s: CreatureState): boolean {
  return s.hunger < 20;
}

function energyLow(s: CreatureState): boolean {
  return s.energy < s.energyThreshold;
}

function energyHigh(s: CreatureState): boolean {
  return s.energy > s.energyThreshold + 10;
}

function energyRested(s: CreatureState): boolean {
  return s.energy > 90;
}

function hasInteractions(s: CreatureState): boolean {
  return s.interactionsThisTick > 0;
}

function stuckTooLong(s: CreatureState): boolean {
  return s.tickBorn > 0 && (s.tickBorn + 150) < s.interactionsThisTick;
}

function wanderTimeout(s: CreatureState): boolean {
  // After wandering for a while, settle back if not hungry
  return s.currentNodeId === 'wandering' && s.tickBorn > 0 && s.interactionsThisTick > 80 && hungerLow(s) && energyHigh(s);
}

// ─── Death edges (wildcard — fire from any node) ────────────────────────────

const DEATH_EDGES: CreatureEdge[] = [
  {
    id: 'death-starvation',
    from: '*',
    to: 'dead',
    condition: (s: CreatureState) => s.hunger >= 100 && s.hp > 0,
    eventType: 'creature_died',
    onTransition: (s: CreatureState) => ({ hp: 0, mood: 'dead' as const }),
    priority: 100,
  },
  {
    id: 'death-exhaustion',
    from: '*',
    to: 'dead',
    condition: (s: CreatureState) => s.energy <= 0 && s.hp > 0,
    eventType: 'creature_died',
    onTransition: (s: CreatureState) => ({ hp: 0, mood: 'dead' as const }),
    priority: 100,
  },
];

// ─── Base graph (shared by all creature types) ───────────────────────────────

export const DEFAULT_CREATURE_EDGES: CreatureEdge[] = [
  // ── From idle ──────────────────────────────────────────────────────────
  {
    id: 'idle→wandering:hungry',
    from: 'idle',
    to: 'wandering',
    condition: (s: CreatureState) => isIdle(s) && hungerHigh(s),
    eventType: 'became_hungry',
    onTransition: (s: CreatureState) => ({ mood: 'hungry' as const }),
    priority: 10,
  },
  {
    id: 'idle→sleeping:tired',
    from: 'idle',
    to: 'sleeping',
    condition: (s: CreatureState) => isIdle(s) && energyLow(s),
    eventType: 'became_tired',
    onTransition: (s: CreatureState) => ({ mood: 'sleeping' as const }),
    priority: 10,
  },

  // ── From wandering ─────────────────────────────────────────────────────
  {
    id: 'wandering→seeking_food',
    from: 'wandering',
    to: 'seeking_food',
    condition: (s: CreatureState) => isWandering(s) && hungerCritical(s),
    eventType: 'became_desperately_hungry',
    onTransition: (s: CreatureState) => ({ mood: 'hungry' as const }),
    priority: 10,
  },
  {
    id: 'wandering→idle:settled',
    from: 'wandering',
    to: 'idle',
    condition: (s: CreatureState) => isWandering(s) && wanderTimeout(s),
    eventType: 'settled_down',
    onTransition: (s: CreatureState) => ({ mood: 'idle' as const }),
    priority: 1,
  },

  // ── From seeking_food ───────────────────────────────────────────────────
  {
    id: 'seek_food→eating:found',
    from: 'seeking_food',
    to: 'eating',
    condition: (s: CreatureState) => isSeekingFood(s) && hasInteractions(s),
    eventType: 'found_food',
    priority: 10,
  },
  {
    id: 'seek_food→idle:give_up',
    from: 'seeking_food',
    to: 'idle',
    condition: (s: CreatureState) => isSeekingFood(s) && stuckTooLong(s),
    eventType: 'could_not_find_food',
    onTransition: (s: CreatureState) => ({ mood: 'idle' as const }),
    priority: 5,
  },

  // ── From eating ────────────────────────────────────────────────────────
  {
    id: 'eating→idle:done',
    from: 'eating',
    to: 'idle',
    condition: (s: CreatureState) => isEating(s) && hungerFull(s),
    eventType: 'finished_eating',
    onTransition: (s: CreatureState) => ({
      hunger: Math.max(0, s.hunger - 40),
      mood: 'idle' as const,
      lastAteTick: s.tickBorn,
    }),
    priority: 10,
  },

  // ── From sleeping ──────────────────────────────────────────────────────
  {
    id: 'sleeping→idle:rested',
    from: 'sleeping',
    to: 'idle',
    condition: (s: CreatureState) => isSleeping(s) && energyRested(s),
    eventType: 'woke_up',
    onTransition: (s: CreatureState) => ({
      energy: Math.min(100, s.energy + 30),
      mood: 'idle' as const,
      lastSleptTick: s.tickBorn,
    }),
    priority: 10,
  },

  // ── Back to wandering from eating (if interrupted) ────────────────────
  {
    id: 'eating→wandering:interrupted',
    from: 'eating',
    to: 'wandering',
    condition: (s: CreatureState) => isEating(s) && s.interactionsThisTick > 30 && !hungerFull(s),
    eventType: 'eating_interrupted',
    priority: 3,
  },

  // ── Global decay edge (fires every tick, applied after other edges) ──
  {
    id: 'decay:energy',
    from: '*',
    to: '*',
    condition: (s: CreatureState) => !isDead(s),
    onTransition: (s: CreatureState) => {
      if (isSleeping(s)) {
        return { energy: Math.min(100, s.energy + s.energyRecoveryRate * (s.tickBorn / 1000)) };
      }
      if (isHunting(s)) {
        return {
          hunger: Math.min(100, s.hunger + s.hungerRate * 1.5),
          energy: Math.max(0, s.energy - s.energyRate * 2),
        };
      }
      return {
        hunger: Math.min(100, s.hunger + s.hungerRate),
        energy: Math.max(0, s.energy - s.energyRate * 0.5),
      };
    },
    priority: -100, // lowest — runs last, after state transitions settle
  },
  ...DEATH_EDGES,
];

// ─── Bat extra edges (predator, can hunt) ───────────────────────────────────

export const BAT_EXTRA_EDGES: CreatureEdge[] = [
  {
    id: 'bat:idle→hunting',
    from: 'idle',
    to: 'hunting',
    condition: (s: CreatureState) =>
      isIdle(s) && s.energy > 50 && hungerHigh(s),
    eventType: 'spotted_prey',
    onTransition: (s: CreatureState) => ({ mood: 'hunting' as const }),
    priority: 12,
  },
  {
    id: 'bat:hunting→idle:caught',
    from: 'hunting',
    to: 'idle',
    condition: (s: CreatureState) => isHunting(s) && hasInteractions(s),
    eventType: 'caught_prey',
    onTransition: (s: CreatureState) => ({
      hunger: Math.max(0, s.hunger - 50),
      mood: 'idle' as const,
    }),
    priority: 10,
  },
  {
    id: 'bat:hunting→idle:give_up',
    from: 'hunting',
    to: 'idle',
    condition: (s: CreatureState) => isHunting(s) && stuckTooLong(s),
    eventType: 'prey_escaped',
    onTransition: (s: CreatureState) => ({
      energy: Math.max(0, s.energy - 20),
      mood: 'idle' as const,
    }),
    priority: 5,
  },
];

// ─── Slime extra edges (slow, absorbs things) ─────────────────────────────────

export const SLIME_EXTRA_EDGES: CreatureEdge[] = [
  // Slime bonds with other slimes
  {
    id: 'slime:bond',
    from: 'idle',
    to: 'idle',
    condition: (s: CreatureState) => s.interactionsThisTick > 0 && s.mood === 'social',
    eventType: 'slime_bonded',
    priority: 5,
  },
];

// ─── Ghost extra edges (ethereal, minimal needs) ─────────────────────────────

export const GHOST_EXTRA_EDGES: CreatureEdge[] = [
  {
    id: 'ghost:drift',
    from: 'idle',
    to: 'wandering',
    condition: (s: CreatureState) => isIdle(s) && Math.random() < 0.01, // rare random drift
    eventType: 'ghost_drifted',
    priority: 1,
  },
];

// ─── Goblin extra edges (restless, fast metabolism) ─────────────────────────

export const GOBLIN_EXTRA_EDGES: CreatureEdge[] = [
  // Goblins wander more aggressively
  {
    id: 'goblin:restless',
    from: 'idle',
    to: 'wandering',
    condition: (s: CreatureState) => isIdle(s) && Math.random() < 0.03,
    eventType: 'became_restless',
    priority: 8,
  },
  {
    id: 'goblin:double-hungry',
    from: 'idle',
    to: 'wandering',
    condition: (s: CreatureState) => isIdle(s) && hungerHigh(s),
    eventType: 'became_hungry',
    priority: 15,
  },
];

// ─── Skeleton extra edges (relentless, forgets hunger) ───────────────────────

export const SKELETON_EXTRA_EDGES: CreatureEdge[] = [
  // Skeletons don't sleep until truly exhausted
  {
    id: 'skeleton:only-sleep-when-critical',
    from: 'idle',
    to: 'sleeping',
    condition: (s: CreatureState) => isIdle(s) && s.energy < 5,
    eventType: 'became_tired',
    priority: 20,
  },
  // Skeletons forget hunger until critical
  {
    id: 'skeleton:ignore-hunger-until-critical',
    from: 'idle',
    to: 'wandering',
    condition: (s: CreatureState) => isIdle(s) && s.hunger > 90,
    eventType: 'became_starving',
    priority: 18,
  },
];

// ─── Spider extra edges (patient weaver) ─────────────────────────────────────

export const SPIDER_EXTRA_EDGES: CreatureEdge[] = [
  {
    id: 'spider:wait',
    from: 'idle',
    to: 'idle',
    condition: (s: CreatureState) => isIdle(s) && s.energy > 30 && hungerLow(s),
    eventType: 'spider_waiting',
    onTransition: (s: CreatureState) => ({ energy: s.energy - 0.1 }),
    priority: 12,
  },
  {
    id: 'spider:strike',
    from: 'idle',
    to: 'hunting',
    condition: (s: CreatureState) => isIdle(s) && hungerHigh(s) && s.energy > 25,
    eventType: 'spider_strikes',
    onTransition: (s: CreatureState) => ({ mood: 'hunting' as const }),
    priority: 14,
  },
];

// ─── Mushroom (stationary food source) ───────────────────────────────────────

export const MUSHROOM_EDGES: CreatureEdge[] = [
  // Stationary — no transitions. Spawns, exists, gets eaten, respawns.
  // Hunger/energy decay is 0, so it never changes state on its own.
  {
    id: 'mushroom:exist',
    from: 'idle',
    to: 'idle',
    condition: () => true,
    priority: -1000,
  },
];

// ─── Heart extra edges (gentle, social glow) ────────────────────────────────

export const HEART_EXTRA_EDGES: CreatureEdge[] = [
  {
    id: 'heart:glow-nearby',
    from: 'idle',
    to: 'idle',
    condition: (s: CreatureState) => s.interactionsThisTick > 0,
    eventType: 'heart_glowed',
    priority: 5,
  },
  // Heart rarely needs anything
  {
    id: 'heart:social',
    from: 'idle',
    to: 'idle',
    condition: (s: CreatureState) => s.mood === 'social',
    eventType: 'heart_social',
    priority: 3,
  },
];

// ─── Crab extra edges (slow, patient) ─────────────────────────────────────

export const CRAB_EXTRA_EDGES: CreatureEdge[] = [
  // Crab moves very slowly
  {
    id: 'crab:slow-wander',
    from: 'wandering',
    to: 'idle',
    condition: (s: CreatureState) => isWandering(s) && s.interactionsThisTick > 60,
    eventType: 'crab_settled',
    priority: 5,
  },
];

// ─── Fish extra edges (schooling) ────────────────────────────────────────────

export const FISH_EXTRA_EDGES: CreatureEdge[] = [
  // Fish seeks company
  {
    id: 'fish:school',
    from: 'idle',
    to: 'wandering',
    condition: (s: CreatureState) => isIdle(s) && s.interactionsThisTick === 0,
    eventType: 'fish_seeking_school',
    priority: 6,
  },
];

// ─── Frog extra edges (ambush predator) ─────────────────────────────────────

export const FROG_EXTRA_EDGES: CreatureEdge[] = [
  {
    id: 'frog:ambush',
    from: 'idle',
    to: 'hunting',
    condition: (s: CreatureState) => isIdle(s) && s.energy > 40 && hungerHigh(s),
    eventType: 'frog_ambush_ready',
    priority: 12,
  },
  {
    id: 'frog:hop',
    from: 'hunting',
    to: 'idle',
    condition: (s: CreatureState) => isHunting(s) && hasInteractions(s),
    eventType: 'frog_hopped',
    onTransition: (s: CreatureState) => ({ mood: 'idle' as const }),
    priority: 10,
  },
];

// ─── Registry ────────────────────────────────────────────────────────────────

type EdgeGraphMap = Record<string, CreatureEdge[]>;

export const CREATURE_EDGE_GRAPHS: EdgeGraphMap = {
  default: DEFAULT_CREATURE_EDGES,
  bat: [...DEFAULT_CREATURE_EDGES, ...BAT_EXTRA_EDGES],
  slime: [...DEFAULT_CREATURE_EDGES, ...SLIME_EXTRA_EDGES],
  ghost: [...DEFAULT_CREATURE_EDGES, ...GHOST_EXTRA_EDGES],
  goblin: [...DEFAULT_CREATURE_EDGES, ...GOBLIN_EXTRA_EDGES],
  skeleton: [...DEFAULT_CREATURE_EDGES, ...SKELETON_EXTRA_EDGES],
  spider: [...DEFAULT_CREATURE_EDGES, ...SPIDER_EXTRA_EDGES],
  mushroom: [...DEFAULT_CREATURE_EDGES, ...MUSHROOM_EDGES],
  heart: [...DEFAULT_CREATURE_EDGES, ...HEART_EXTRA_EDGES],
  crab: [...DEFAULT_CREATURE_EDGES, ...CRAB_EXTRA_EDGES],
  fish: [...DEFAULT_CREATURE_EDGES, ...FISH_EXTRA_EDGES],
  frog: [...DEFAULT_CREATURE_EDGES, ...FROG_EXTRA_EDGES],
};

export function getEdgeGraph(graphName: string): CreatureEdge[] {
  return CREATURE_EDGE_GRAPHS[graphName] ?? CREATURE_EDGE_GRAPHS['default'];
}
