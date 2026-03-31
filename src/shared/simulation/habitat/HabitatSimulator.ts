/**
 * HabitatSimulator — runs the creature simulation.
 *
 * Owns one GraphEngine per creature for individual edge evaluation,
 * plus a shared InteractionGraph pass for pairwise creature interactions.
 *
 * Tick order each frame:
 *  1. Reset interactionsThisTick on all creatures
 *  2. Evaluate interaction edges between all pairs → apply effects, collect events
 *  3. For each creature: evaluate its edge graph → apply transitions, collect events
 *  4. Tick global decay (applied via edges with priority -100)
 *  5. Return all events collected this tick
 *
 * Renderer maps events → Creature.setState() / setPosition() calls.
 */
import type {
  StateVector,
  SimulationEvent,
  Checkpoint,
  Interrupt,
  InterruptChoice,
  EvalResult,
} from '../types.js';
import { GraphEngine } from '../GraphEngine.js';
import { CheckpointManager } from '../CheckpointManager.js';
import { SeededRandom } from '../SeededRandom.js';
import { InterruptBrokerImpl } from '../InterruptBroker.js';
import type { CreatureState, CreatureSimConfig } from './CreatureState.js';
import { mergeSimConfig } from './CreatureState.js';
import type { CreatureEdge } from './CreatureEdgeGraph.js';
import { getEdgeGraph } from './CreatureEdgeGraph.js';
import type { InteractionResult } from './CreatureInteractionGraph.js';
import { InteractionGraph } from './CreatureInteractionGraph.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HabitatSimState extends StateVector {
  tick: number;
  creatures: Record<string, CreatureState>;
  lastCheckpointId: string | null;
  rngSeed: number;
}

export type HabitatSimEvent = SimulationEvent;

export interface SerializedHabitatSim {
  state: HabitatSimState;
  rngSeed: number;
  tick: number;
}

export interface CreatureSpawnParams {
  creatureId: string;
  spriteId: string;
  x: number;
  y: number;
  territoryX?: number;
  territoryY?: number;
  territoryRadius?: number;
  config?: Partial<CreatureSimConfig>;
}

interface CreatureEngineEntry {
  engine: GraphEngine<CreatureState, HabitatSimEvent>;
  state: CreatureState;
}

// ─── Simulator ───────────────────────────────────────────────────────────────

export class HabitatSimulator {
  private creatures = new Map<string, CreatureEngineEntry>();
  private interactionGraph = new InteractionGraph();
  private _tick = 0;
  private rng: SeededRandom;
  private checkpointManager: CheckpointManager<HabitatSimState>;
  private interruptBroker = new InterruptBrokerImpl();
  private allEvents: HabitatSimEvent[] = [];
  private _onCheckpoint: ((cp: Checkpoint<HabitatSimState>) => void) | null = null;
  private _onInterrupt: ((intr: Interrupt) => void) | null = null;

  constructor(seed?: number) {
    this.rng = new SeededRandom(seed ?? Date.now());
    this.checkpointManager = new CheckpointManager<HabitatSimState>({
      maxCheckpoints: 50,
      autoCheckpointEveryNTicks: 60, // ~every second at 60fps
      onCheckpoint: (cp) => this._onCheckpoint?.(cp),
    });

    this.interruptBroker.onInterruptRequested = (intr) => this._onInterrupt?.(intr);
  }

  // ─── Setup ──────────────────────────────────────────────────────────────

  onCheckpoint(fn: (cp: Checkpoint<HabitatSimState>) => void): void {
    this._onCheckpoint = fn;
  }

  onInterrupt(fn: (intr: Interrupt) => void): void {
    this._onInterrupt = fn;
  }

  /**
   * Spawn a new creature into the simulation.
   */
  spawn(params: CreatureSpawnParams): CreatureState {
    const simConfig = mergeSimConfig(params.config ?? {});

    const state: CreatureState = {
      creatureId: params.creatureId,
      spriteId: params.spriteId,
      position: { x: params.x, y: params.y },
      targetPosition: null,
      hunger: 10,
      energy: 80,
      hp: simConfig.maxHp,
      maxHp: simConfig.maxHp,
      mood: 'idle',
      currentNodeId: simConfig.initialNodeId,
      lastAction: null,
      tickBorn: this._tick,
      lastAteTick: this._tick,
      lastSleptTick: this._tick,
      interactionsThisTick: 0,
      edgeCooldowns: {},
      territoryX: params.territoryX ?? params.x,
      territoryY: params.territoryY ?? params.y,
      territoryRadius: params.territoryRadius ?? simConfig.territorySize,
    };

    // Build per-creature engine
    const edges = getEdgeGraph(simConfig.edgeGraph ?? 'default');
    const engine = new GraphEngine<CreatureState, HabitatSimEvent>(
      buildCreatureNodes(simConfig),
      edges,
      state,
      state.currentNodeId,
      this.rng.clone(),
      new CheckpointManager<CreatureState>({ maxCheckpoints: 5, autoCheckpointEveryNTicks: 0 }),
      this.interruptBroker as any,
    );

    this.creatures.set(params.creatureId, { engine, state });
    return state;
  }

  /** Remove a creature. */
  remove(creatureId: string): void {
    this.creatures.delete(creatureId);
  }

  // ─── Tick ───────────────────────────────────────────────────────────────

  /**
   * Advance the simulation by deltaMs milliseconds.
   * Returns all events that occurred this tick.
   */
  tick(deltaMs: number): HabitatSimEvent[] {
    const events: HabitatSimEvent[] = [];
    const deltaTick = Math.max(1, Math.round(deltaMs / 16.67)); // normalize to ~60fps ticks
    const ctx = { tick: this._tick, rng: this.rng, deltaMs };

    // 1. Reset interactionsThisTick for all creatures
    for (const entry of this.creatures.values()) {
      entry.state.interactionsThisTick = 0;
    }

    // 2. Interaction pass — reads from all pairs, applies joint effects
    const allCreatures = [...this.creatures.values()].map((e) => e.state);
    const interactionResults = this.interactionGraph.evaluate(allCreatures, {
      tick: this._tick,
      rng: this.rng,
    });

    for (const result of interactionResults) {
      const source = this.creatures.get(result.sourceId);
      const target = this.creatures.get(result.targetId);

      if (result.sourceEffect && source) {
        Object.assign(source.state, result.sourceEffect);
        source.state.lastAction = result.edgeId;
      }
      if (result.targetEffect && target) {
        Object.assign(target.state, result.targetEffect);
        target.state.lastAction = result.edgeId;
      }
      if (source) source.state.interactionsThisTick++;
      if (target) target.state.interactionsThisTick++;

      events.push(...result.events);
    }

    // 3. Per-creature graph evaluation
    for (const [id, entry] of this.creatures) {
      // Skip dead creatures
      if (entry.state.mood === 'dead') continue;

      const prev = entry.state.position;
      const prevMood = entry.state.mood;

      const result = entry.engine.tick(deltaMs);
      entry.state = result.state;

      // Emit position change events if position changed significantly
      if (
        Math.abs(result.state.position.x - prev.x) > 1 ||
        Math.abs(result.state.position.y - prev.y) > 1
      ) {
        events.push({
          type: 'creature_moved',
          nodeId: id,
          tick: this._tick,
          data: {
            from: prev,
            to: result.state.position,
            mood: result.state.mood,
          },
        });
      }

      // Emit mood change events
      if (result.state.mood !== prevMood) {
        events.push({
          type: 'creature_mood_changed',
          nodeId: id,
          tick: this._tick,
          data: { from: prevMood, to: result.state.mood },
        });
      }

      // Emit any events from the creature engine
      events.push(...result.events);
    }

    // 4. Auto-checkpoint
    if (this._tick % 60 === 0 && this._tick > 0) {
      this.checkpointManager.checkpoint(
        this.getState() as HabitatSimState,
        this._tick,
        this.rng,
        `auto-${this._tick}`,
      );
    }

    this.allEvents.push(...events);
    this._tick++;
    return events;
  }

  // ─── Interrupt ──────────────────────────────────────────────────────────

  /**
   * Request an interrupt (human-in-the-loop decision).
   */
  requestInterrupt(interrupt: Interrupt): void {
    this.interruptBroker.requestInterrupt(interrupt);
  }

  /**
   * Resolve a pending interrupt.
   */
  resolveInterrupt(interruptId: string, choice: InterruptChoice): void {
    this.interruptBroker.resolveInterrupt(interruptId, choice);
  }

  dismissInterrupt(interruptId: string): void {
    this.interruptBroker.dismissInterrupt(interruptId);
  }

  getActiveInterrupt(): Interrupt | null {
    return this.interruptBroker.getActiveInterrupt();
  }

  // ─── Time-travel ────────────────────────────────────────────────────────

  checkpoint(label?: string): Checkpoint<HabitatSimState> {
    return this.checkpointManager.checkpoint(
      this.getState() as HabitatSimState,
      this._tick,
      this.rng,
      label,
    );
  }

  rewind(checkpointId: string): boolean {
    const cp = this.checkpointManager.rewind(checkpointId);
    if (!cp) return false;

    // Restore creature states and engines from checkpoint
    const state = cp.state as HabitatSimState;
    this._tick = cp.tick;
    this.rng = new SeededRandom(cp.rngSeed);

    // Rebuild creature engines from restored state
    for (const [id, cState] of Object.entries(state.creatures)) {
      const edges = getEdgeGraph(
        (cState as unknown as Record<string, unknown>)['edgeGraph'] as string ?? 'default',
      );
      const engine = new GraphEngine<CreatureState, HabitatSimEvent>(
        buildCreatureNodes(mergeSimConfig({})),
        edges,
        cState,
        cState.currentNodeId,
        this.rng.clone(),
        new CheckpointManager<CreatureState>({ maxCheckpoints: 5, autoCheckpointEveryNTicks: 0 }),
      );
      this.creatures.set(id, { engine, state: cState });
    }

    return true;
  }

  branch(checkpointId: string, label?: string): string {
    const branched = this.checkpointManager.branch(checkpointId, {
      from: checkpointId,
      label,
    });
    return branched?.id ?? checkpointId;
  }

  getTimeline(): Checkpoint<HabitatSimState>[] {
    return this.checkpointManager.list();
  }

  // ─── State queries ─────────────────────────────────────────────────────

  getCreatureState(creatureId: string): CreatureState | null {
    return this.creatures.get(creatureId)?.state ?? null;
  }

  getAllCreatures(): CreatureState[] {
    return [...this.creatures.values()].map((e) => e.state);
  }

  getState(): HabitatSimState {
    return {
      tick: this._tick,
      creatures: Object.fromEntries(
        [...this.creatures.entries()].map(([k, v]) => [k, v.state])
      ) as Record<string, CreatureState>,
      lastCheckpointId: null,
      rngSeed: this.rng.getSeed(),
    };
  }

  getTick(): number {
    return this._tick;
  }

  getEventsSince(tick: number): HabitatSimEvent[] {
    return this.allEvents.filter((e) => e.tick > tick);
  }

  getAllEvents(): HabitatSimEvent[] {
    return [...this.allEvents];
  }

  // ─── Serialization ─────────────────────────────────────────────────────

  serialize(): SerializedHabitatSim {
    return {
      state: this.getState(),
      rngSeed: this.rng.getSeed(),
      tick: this._tick,
    };
  }
}

// ─── Per-creature Node Evaluators ──────────────────────────────────────────

/**
 * Build the node evaluator map for a single creature type.
 * Each node runs the creature's edge graph; the graph itself handles transitions.
 *
 * The node evaluators here are thin wrappers — the real logic lives in the edges.
 */
function buildCreatureNodes(
  config: Required<CreatureSimConfig>,
): Record<string, import('../types.js').NodeEvaluator<CreatureState, HabitatSimEvent>> {
  // The base evaluator — in this model, edges drive state changes, not nodes.
  // Nodes just run a tick. We use a single 'active' node.
  return {
    active: {
      evaluate: (state, _ctx) => ({
        state,
        events: [],
        activeNodeId: state.currentNodeId,
      }),
    },
    idle: {
      evaluate: (state, ctx) => ({
        state,
        events: [],
        activeNodeId: evaluateMood(state),
      }),
    },
    wandering: {
      evaluate: (state, ctx) => {
        const next = wanderTarget(state, ctx);
        return {
          state: { ...state, targetPosition: next },
          events: [],
          activeNodeId: state.currentNodeId,
        };
      },
    },
    seeking_food: {
      evaluate: (state, ctx) => {
        const target = seekFoodTarget(state, ctx);
        return {
          state: { ...state, targetPosition: target },
          events: [],
          activeNodeId: state.currentNodeId,
        };
      },
    },
    eating: {
      evaluate: (state, _ctx) => ({
        state,
        events: [],
        activeNodeId: state.currentNodeId,
      }),
    },
    sleeping: {
      evaluate: (state, _ctx) => ({
        state,
        events: [],
        activeNodeId: state.currentNodeId,
      }),
    },
    hunting: {
      evaluate: (state, ctx) => {
        const target = huntTarget(state, ctx);
        return {
          state: { ...state, targetPosition: target },
          events: [],
          activeNodeId: state.currentNodeId,
        };
      },
    },
    dead: {
      evaluate: (state, _ctx) => ({
        state,
        events: [],
        activeNodeId: 'dead',
      }),
    },
  };
}

function evaluateMood(state: CreatureState): string {
  if (state.hunger >= state.hungerThreshold) return 'hungry';
  if (state.energy < state.energyThreshold) return 'tired';
  return 'idle';
}

function wanderTarget(
  state: CreatureState,
  ctx: { rng: { next: () => number } },
): { x: number; y: number } {
  const r = ctx.rng.next;
  const angle = r() * 2 * Math.PI;
  const radius = state.territoryRadius * 0.6 * r();
  return {
    x: state.territoryX + Math.cos(angle) * radius,
    y: state.territoryY + Math.sin(angle) * radius,
  };
}

function seekFoodTarget(
  state: CreatureState,
  ctx: { rng: { next: () => number } },
): { x: number; y: number } {
  // Move toward territory center when seeking food
  const dx = state.territoryX - state.position.x;
  const dy = state.territoryY - state.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 5) return wanderTarget(state, ctx);
  return {
    x: state.position.x + (dx / dist) * 2,
    y: state.position.y + (dy / dist) * 2,
  };
}

function huntTarget(
  state: CreatureState,
  ctx: { rng: { next: () => number } },
): { x: number; y: number } {
  // Move more aggressively during hunt
  const target = seekFoodTarget(state, ctx);
  const dx = target.x - state.position.x;
  const dy = target.y - state.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 5) return wanderTarget(state, ctx);
  return {
    x: state.position.x + (dx / dist) * 3,
    y: state.position.y + (dy / dist) * 3,
  };
}
