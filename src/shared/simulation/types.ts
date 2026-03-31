// ============================================================
// CORE GRAPH ENGINE PRIMITIVES
// ============================================================

export type StateVector = Record<string, unknown>;

// ============================================================
// CHECKPOINT
// ============================================================

export interface Checkpoint<S extends StateVector = StateVector> {
  id: string;
  timestamp: number;
  tick: number;
  state: S;
  rngSeed: number;
  label?: string;
}

export interface CheckpointManagerOptions<S extends StateVector> {
  maxCheckpoints: number;
  autoCheckpointEveryNTicks: number;
  onCheckpoint?: (cp: Checkpoint<S>) => void;
}

export interface BranchOptions<S extends StateVector> {
  from: string;
  label?: string;
  overrideState?: Partial<S>;
}

// ============================================================
// EDGE GRAPH
// ============================================================

export interface Edge<S extends StateVector = StateVector> {
  id: string;
  from: string; // source node id; '*' = wildcard (any node)
  to: string; // destination node id
  condition: ConditionFn<S>;
  onTransition?: TransitionFn<S>;
  eventType?: string;
  priority?: number; // higher = evaluated first; default 0
}

export interface NodeEvaluator<S extends StateVector, E extends SimulationEvent = SimulationEvent> {
  evaluate(state: S, ctx: EvalContext): EvalResult<S, E>;
}

export interface EvalContext {
  tick: number;
  deltaMs: number;
  rng: import('./SeededRandom').SeededRandom;
  interrupt?: Interrupt;
}

export interface EvalResult<S extends StateVector, E extends SimulationEvent = SimulationEvent> {
  state: S;
  events: E[];
  activeNodeId: string;
  checkpointRequested?: boolean;
}

// ============================================================
// SIMULATION EVENTS
// ============================================================

export interface SimulationEvent {
  type: string;
  nodeId: string;
  tick: number;
  data?: Record<string, unknown>;
  fromState?: Record<string, unknown>;
  toState?: Record<string, unknown>;
}

// ============================================================
// CONDITION & TRANSITION FUNCTIONS
// ============================================================

export type ConditionFn<S extends StateVector> = (state: S, ctx: EvalContext) => boolean;
export type TransitionFn<S extends StateVector> = (state: S, ctx: EvalContext) => Partial<S>;

// ============================================================
// INTERRUPT SYSTEM (Human-in-the-Loop)
// ============================================================

export interface Interrupt {
  id: string;
  nodeId: string;
  edgeId: string;
  prompt: string;
  choices: InterruptChoice[];
  defaultChoice?: string;
  deadline?: number;
}

export interface InterruptChoice {
  id: string;
  label: string;
  description?: string;
  injectState?: Partial<StateVector>;
  suppressEvents?: string[];
}

export interface InterruptBroker {
  requestInterrupt(interrupt: Interrupt): void;
  resolveInterrupt(id: string, choice: InterruptChoice): void;
  dismissInterrupt(id: string): void;
  getActiveInterrupt(): Interrupt | null;
  onInterruptRequested: ((interrupt: Interrupt) => void) | null;
}

// ============================================================
// SERIALIZATION
// ============================================================

export interface SerializedEngine<S extends StateVector, E extends SimulationEvent = SimulationEvent> {
  nodes: string[]; // node IDs
  edges: Edge<S>[];
  state: S;
  activeNodeId: string;
  tick: number;
  rngSeed: number;
  checkpoints: Checkpoint<S>[];
}
