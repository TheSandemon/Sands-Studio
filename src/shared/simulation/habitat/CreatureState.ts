/**
 * CreatureState — the simulation state for a single creature.
 * Lives in HabitatSimulator, not in React state.
 */
import type { StateVector } from '../types.js';

export type CreatureMood =
  | 'idle'
  | 'hungry'
  | 'tired'
  | 'social'
  | 'hunting'
  | 'fleeing'
  | 'sleeping'
  | 'dead';

export interface CreatureState extends StateVector {
  creatureId: string;
  spriteId: string;
  position: { x: number; y: number };
  /** 0–100, 100 = starving */
  hunger: number;
  /** 0–100, 0 = exhausted */
  energy: number;
  hp: number;
  maxHp: number;
  mood: CreatureMood;
  currentNodeId: string;
  lastAction: string | null;
  tickBorn: number;
  lastAteTick: number;
  lastSleptTick: number;
  interactionsThisTick: number;
  /** Track cooldowns: edgeId → tick when it last fired */
  edgeCooldowns: Record<string, number>;
  /** For movement: target position */
  targetPosition: { x: number; y: number } | null;
  territoryX: number;
  territoryY: number;
  territoryRadius: number;
}

export interface CreatureSimConfig {
  edgeGraph?: string; // reference to a named graph
  initialNodeId?: string;
  hungerRate?: number; // hunger decrease per second
  energyRate?: number; // energy decrease per second when active
  energyRecoveryRate?: number; // energy recovery per second when idle/sleeping
  hungerThreshold?: number; // hunger > this → mood becomes hungry
  energyThreshold?: number; // energy < this → mood becomes tired
  maxHp?: number;
  territorySize?: number; // radius in pixels
  speed?: number; // movement speed multiplier
}

export const DEFAULT_SIM_CONFIG: Required<CreatureSimConfig> = {
  edgeGraph: 'default',
  initialNodeId: 'idle',
  hungerRate: 0.5,
  energyRate: 1.0,
  energyRecoveryRate: 2.0,
  hungerThreshold: 70,
  energyThreshold: 20,
  maxHp: 100,
  territorySize: 80,
  speed: 1.0,
};

/** Merge a creature's sim config with defaults */
export function mergeSimConfig(
  config: Partial<CreatureSimConfig>,
): Required<CreatureSimConfig> {
  return { ...DEFAULT_SIM_CONFIG, ...config };
}
