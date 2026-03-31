/**
 * CreatureInteractionGraph — bipartite creature × creature interactions.
 *
 * Defines pairwise interactions between creature types (slime × mushroom,
 * bat × slime, etc.). These fire when two creatures are within range.
 *
 * Unlike creature edge graphs (which are per-creature), interaction edges
 * read from two creature states and produce joint outcomes.
 */
import type { SimulationEvent, StateVector } from '../types.js';
import type { CreatureState } from './CreatureState.js';

export interface InteractionConditionFn {
  (
    source: CreatureState,
    target: CreatureState,
    distance: number,
    ctx: { tick: number; rng: { next: () => number } },
  ): boolean;
}

export interface InteractionOutcomeFn {
  (
    source: CreatureState,
    target: CreatureState,
    distance: number,
  ): InteractionOutcome;
}

export interface InteractionOutcome {
  sourceEffect?: Partial<CreatureState>;
  targetEffect?: Partial<CreatureState>;
  events: SimulationEvent[];
  /** If true, both creatures are locked (synchronized tick) until resolved */
  locksBoth?: boolean;
}

export interface InteractionEdge {
  id: string;
  /** Pair of spriteIds (order doesn't matter) */
  pair: [string, string];
  condition: InteractionConditionFn;
  /** Outcome is a function so it can reference source/target via closure */
  outcome: InteractionOutcomeFn;
  /** Prevent repeated firing (ticks) */
  cooldownTicks?: number;
  priority?: number;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Default interactions ─────────────────────────────────────────────────────

export const DEFAULT_INTERACTION_EDGES: InteractionEdge[] = [
  {
    id: 'slime-eats-mushroom',
    pair: ['slime', 'mushroom'],
    condition: (_s, _t, d) => d < 24,
    outcome: (s, t, _d) => ({
      sourceEffect: { hunger: Math.max(0, s.hunger - 30) },
      events: [
        {
          type: 'slime_ate_mushroom',
          nodeId: s.creatureId,
          tick: 0,
          data: { slimeId: s.creatureId, mushroomId: t.creatureId },
        },
      ],
    }),
    cooldownTicks: 200,
    priority: 10,
  },
  {
    id: 'bat-attacks-slime',
    pair: ['bat', 'slime'],
    condition: (s, t, d) => d < 32 && s.mood === 'hunting',
    outcome: (s, t, _d) => ({
      sourceEffect: {
        hunger: Math.max(0, s.hunger - 40),
        energy: Math.max(0, s.energy - 15),
      },
      targetEffect: { hp: Math.max(0, t.hp - 15) },
      events: [
        {
          type: 'bat_attacked_slime',
          nodeId: s.creatureId,
          tick: 0,
          data: { batId: s.creatureId, slimeId: t.creatureId },
        },
      ],
    }),
    cooldownTicks: 100,
    priority: 15,
  },
  {
    id: 'slime-defends-from-bat',
    pair: ['slime', 'bat'],
    condition: (s, t, d) => d < 32 && t.mood === 'hunting' && s.hp < s.maxHp * 0.5,
    outcome: (s, t, _d) => ({
      sourceEffect: { energy: Math.max(0, s.energy - 10) },
      targetEffect: { energy: Math.max(0, t.energy - 20), mood: 'idle' as const },
      events: [
        {
          type: 'slime_defended',
          nodeId: s.creatureId,
          tick: 0,
          data: { slimeId: s.creatureId, batId: t.creatureId },
        },
      ],
    }),
    cooldownTicks: 150,
    priority: 20, // slime reacts faster when low HP
  },
  {
    id: 'creatures-social',
    pair: ['slime', 'slime'],
    condition: (s, t, d) => d < 40 && s.mood !== 'dead' && t.mood !== 'dead',
    outcome: (s, t, _d) => ({
      sourceEffect: { mood: 'social' as const },
      targetEffect: { mood: 'social' as const },
      events: [
        {
          type: 'creatures_met',
          nodeId: s.creatureId,
          tick: 0,
          data: { a: s.creatureId, b: t.creatureId },
        },
      ],
    }),
    cooldownTicks: 300,
    priority: 1,
  },
];

// ─── InteractionGraph class ─────────────────────────────────────────────────

export class InteractionGraph {
  constructor(private edges: InteractionEdge[] = DEFAULT_INTERACTION_EDGES) {}

  /**
   * Evaluate all interaction edges between all pairs of creatures.
   * Returns events and state mutations to apply.
   */
  evaluate(
    creatures: CreatureState[],
    ctx: { tick: number; rng: { next: () => number } },
  ): InteractionResult[] {
    const results: InteractionResult[] = [];

    for (let i = 0; i < creatures.length; i++) {
      for (let j = i + 1; j < creatures.length; j++) {
        const a = creatures[i];
        const b = creatures[j];

        // Check cooldown
        const relevantEdges = this.edges.filter((e) => {
          const [p1, p2] = e.pair;
          return (
            (a.spriteId === p1 && b.spriteId === p2) ||
            (a.spriteId === p2 && b.spriteId === p1)
          );
        });

        for (const edge of relevantEdges) {
          // Skip if either creature is on cooldown for this edge
          if (
            edge.cooldownTicks &&
            ((a.edgeCooldowns[edge.id] ?? 0) + edge.cooldownTicks > ctx.tick ||
              (b.edgeCooldowns[edge.id] ?? 0) + edge.cooldownTicks > ctx.tick)
          ) {
            continue;
          }

          const d = dist(a.position, b.position);
          const source = a.spriteId === edge.pair[0] ? a : b;
          const target = a.spriteId === edge.pair[0] ? b : a;

          try {
            if (edge.condition(source, target, d, ctx)) {
              // Apply cooldowns
              source.edgeCooldowns[edge.id] = ctx.tick;
              target.edgeCooldowns[edge.id] = ctx.tick;

              const outcome = edge.outcome(source, target, d);
              results.push({
                edgeId: edge.id,
                sourceId: source.creatureId,
                targetId: target.creatureId,
                sourceEffect: outcome.sourceEffect,
                targetEffect: outcome.targetEffect,
                events: outcome.events.map((e) => ({ ...e, tick: ctx.tick })),
                locksBoth: outcome.locksBoth,
              });
            }
          } catch (err) {
            console.warn(`[InteractionGraph] Edge "${edge.id}" condition threw:`, err);
          }
        }
      }
    }

    return results;
  }

  /** Add a custom interaction edge at runtime */
  addEdge(edge: InteractionEdge): void {
    this.edges.push(edge);
  }
}

export interface InteractionResult {
  edgeId: string;
  sourceId: string;
  targetId: string;
  sourceEffect?: Partial<CreatureState>;
  targetEffect?: Partial<CreatureState>;
  events: SimulationEvent[];
  locksBoth?: boolean;
}
