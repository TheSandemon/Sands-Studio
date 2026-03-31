import type {
  Edge,
  NodeEvaluator,
  EvalContext,
  EvalResult,
  SimulationEvent,
  StateVector,
  Checkpoint,
  Interrupt,
  InterruptChoice,
  SerializedEngine,
} from './types.js';
import type { SeededRandom } from './SeededRandom.js';
import type { CheckpointManager } from './CheckpointManager.js';
import { CheckpointManager as DefaultCheckpointManager } from './CheckpointManager.js';

/**
 * Core graph evaluation engine.
 *
 * Evaluates all outgoing edges from the active node each tick.
 * Fires transitions, emits events, and optionally checkpoints state.
 *
 * Edges are data; nodes are NodeEvaluator implementations.
 * This separation lets the graph topology be serialized as JSON
 * while keeping evaluation logic in TypeScript.
 */
export class GraphEngine<
  S extends StateVector,
  E extends SimulationEvent = SimulationEvent,
> {
  private activeNodeId: string;
  private _tick = 0;
  private _state: S;
  private _events: E[] = [];
  private eventIndexSince = 0; // index into this.events for getEventsSince
  private interruptPending: Interrupt | null = null;
  private _checkpointRequested = false;

  constructor(
    private nodes: Record<string, NodeEvaluator<S, E>>,
    private edges: Edge<S>[],
    initialState: S,
    initialNodeId: string,
    private rng: SeededRandom,
    private checkpointManager: CheckpointManager<S>,
    private interruptBroker?: { onInterruptRequested: ((i: Interrupt) => void) | null },
  ) {
    this._state = structuredClone(initialState) as S;
    this.activeNodeId = initialNodeId;
  }

  // ─── Tick ────────────────────────────────────────────────────────────────

  /**
   * Evaluate one simulation step (one "tick").
   * 1. Run the active node's evaluator
   * 2. Evaluate all outgoing edges (sorted by priority desc)
   * 3. Fire the first matching edge (or none)
   * 4. Auto-checkpoint if configured
   * Returns the eval result for this tick.
   */
  tick(deltaMs: number): EvalResult<S, E> {
    if (this.interruptPending) {
      // Paused — return no-op
      return {
        state: this._state,
        events: [],
        activeNodeId: this.activeNodeId,
        checkpointRequested: false,
      };
    }

    const ctx = this.buildContext(deltaMs);
    const events: E[] = [];

    // Run node evaluator
    const nodeResult = this.nodes[this.activeNodeId]?.evaluate(this._state, ctx);
    if (nodeResult) {
      this._state = nodeResult.state;
      events.push(...nodeResult.events);
    }

    // Evaluate edges — sort by priority desc (highest first)
    const outgoing = this.edges
      .filter((e) => e.from === this.activeNodeId || e.from === '*')
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const edge of outgoing) {
      try {
        if (edge.condition(this._state, ctx)) {
          // Transition
          const previousState = { ...this._state } as Record<string, unknown>;
          if (edge.onTransition) {
            const delta = edge.onTransition(this._state, ctx);
            Object.assign(this._state, delta);
          }

          if (edge.eventType) {
            events.push({
              type: edge.eventType,
              nodeId: this.activeNodeId,
              tick: this._tick,
              data: { edgeId: edge.id, to: edge.to },
              fromState: previousState,
              toState: { ...this._state } as Record<string, unknown>,
            } as E);
          }

          this.activeNodeId = edge.to;
          break; // only fire first matching edge per tick
        }
      } catch (err) {
        console.warn(`[GraphEngine] Edge "${edge.id}" condition threw:`, err);
      }
    }

    this._events.push(...events);
    this._tick++;
    this.eventIndexSince = this._events.length;

    // Auto-checkpoint
    if (
      this.checkpointManager &&
      this._tick % this.checkpointManager['opts'].autoCheckpointEveryNTicks === 0
    ) {
      this.checkpointManager.checkpoint(this._state, this._tick, this.rng);
    }

    return {
      state: this._state,
      events,
      activeNodeId: this.activeNodeId,
      checkpointRequested: this._checkpointRequested,
    };
  }

  // ─── Interrupt ───────────────────────────────────────────────────────────

  /**
   * Trigger an interrupt. The engine pauses tick() until resolveInterrupt is called.
   * onInterruptRequested callback (if set) is invoked immediately.
   */
  requestInterrupt(interrupt: Interrupt): void {
    this.interruptPending = interrupt;
    this.interruptBroker?.onInterruptRequested?.(interrupt);
  }

  /**
   * Resolve a pending interrupt — merge the chosen state injection and resume.
   */
  resolveInterrupt(interruptId: string, choice: InterruptChoice): void {
    if (!this.interruptPending || this.interruptPending.id !== interruptId) return;

    const intr = this.interruptPending;
    this.interruptPending = null;

    if (choice.injectState) {
      Object.assign(this._state, choice.injectState);
    }

    // Suppress any suppressed event types that arrived during the interrupt
    if (choice.suppressEvents?.length) {
      this._events = this._events.filter(
        (e) => !choice.suppressEvents!.includes(e.type)
      );
    }

    // Request checkpoint after interrupt resolution
    this.checkpointManager.checkpoint(this._state, this._tick, this.rng, `interrupt-${intr.id}`);
  }

  dismissInterrupt(interruptId: string): void {
    if (!this.interruptPending || this.interruptPending.id !== interruptId) return;
    this.interruptPending = null;
  }

  getActiveInterrupt(): Interrupt | null {
    return this.interruptPending;
  }

  // ─── Time-travel ─────────────────────────────────────────────────────────

  /** Force a checkpoint to be stored. */
  checkpoint(label?: string): Checkpoint<S> {
    return this.checkpointManager.checkpoint(this._state, this._tick, this.rng, label);
  }

  /** Rewind to a previous checkpoint. */
  rewind(checkpointId: string): boolean {
    const reverted = this.checkpointManager.rewind(checkpointId);
    if (!reverted) return false;
    this._state = structuredClone(reverted.state) as S;
    this._tick = reverted.tick;
    this.rng = new (this.rng.constructor as new (seed: number) => SeededRandom)(
      reverted.rngSeed
    );
    return true;
  }

  /** Create a named branch from a checkpoint. Returns new branch id. */
  branch(checkpointId: string, label?: string): string {
    const branched = this.checkpointManager.branch(checkpointId, {
      from: checkpointId,
      label,
    });
    return branched?.id ?? checkpointId;
  }

  getCheckpointHistory(): Checkpoint<S>[] {
    return this.checkpointManager.list();
  }

  // ─── State access ────────────────────────────────────────────────────────

  getState(): Readonly<S> {
    return this._state;
  }

  getActiveNodeId(): string {
    return this.activeNodeId;
  }

  getTick(): number {
    return this._tick;
  }

  /** Return all events since the given tick. */
  getEventsSince(sinceTick: number): E[] {
    return this._events.filter((e) => e.tick > sinceTick);
  }

  getAllEvents(): E[] {
    return [...this._events];
  }

  // ─── Graph mutation ──────────────────────────────────────────────────────

  /** Add a new edge at runtime. */
  addEdge(edge: Edge<S>): void {
    this.edges.push(edge);
  }

  /** Remove an edge by id. */
  removeEdge(edgeId: string): void {
    this.edges = this.edges.filter((e) => e.id !== edgeId);
  }

  /** Add a new node evaluator at runtime. */
  addNode(nodeId: string, evaluator: NodeEvaluator<S, E>): void {
    this.nodes[nodeId] = evaluator;
  }

  // ─── Serialization ──────────────────────────────────────────────────────

  serialize(): SerializedEngine<S, E> {
    return {
      nodes: Object.keys(this.nodes),
      edges: this.edges,
      state: structuredClone(this._state) as S,
      activeNodeId: this.activeNodeId,
      tick: this._tick,
      rngSeed: this.rng.getSeed(),
      checkpoints: this.checkpointManager.list(),
    };
  }

  static deserialize<S extends StateVector, E extends SimulationEvent>(
    data: SerializedEngine<S, E>,
    nodes: Record<string, NodeEvaluator<S, E>>,
    rngCtor: new (seed: number) => SeededRandom,
    checkpointOpts: { maxCheckpoints: number; autoCheckpointEveryNTicks: number },
  ): GraphEngine<S, E> {
    const cm = new DefaultCheckpointManager<S>(checkpointOpts);
    // Restore checkpoints
    for (const cp of data.checkpoints) {
      cm['ring'].push(cp);
    }
    const rng = new rngCtor(data.rngSeed);
    const engine = new GraphEngine<S, E>(
      nodes,
      data.edges,
      data.state,
      data.activeNodeId,
      rng,
      cm,
    );
    engine._setTick(data.tick);
    return engine;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  // ─── Private ─────────────────────────────────────────────────────────────

  /** For deserialization — restore tick counter without triggering checkpoint logic */
  _setTick(tick: number): void {
    this._tick = tick;
  }

  private buildContext(deltaMs: number): EvalContext {
    return {
      tick: this._tick,
      deltaMs,
      rng: this.rng,
      interrupt: this.interruptPending ?? undefined,
    };
  }
}
