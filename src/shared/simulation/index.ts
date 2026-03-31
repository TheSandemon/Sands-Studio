// Shared simulation primitives — re-exports
export { GraphEngine } from './GraphEngine.js';
export { CheckpointManager } from './CheckpointManager.js';
export { SeededRandom } from './SeededRandom.js';
export { InterruptBrokerImpl } from './InterruptBroker.js';

export type {
  StateVector,
  Edge,
  NodeEvaluator,
  EvalContext,
  EvalResult,
  SimulationEvent,
  Checkpoint,
  CheckpointManagerOptions,
  BranchOptions,
  Interrupt,
  InterruptChoice,
  InterruptBroker,
  SerializedEngine,
  ConditionFn,
  TransitionFn,
} from './types.js';
