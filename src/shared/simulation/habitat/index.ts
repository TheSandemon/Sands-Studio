// Habitat creature simulation — re-exports
export { HabitatSimulator } from './HabitatSimulator.js';
export { InteractionGraph } from './CreatureInteractionGraph.js';
export {
  DEFAULT_CREATURE_EDGES,
  BAT_EXTRA_EDGES,
  SLIME_EXTRA_EDGES,
  getEdgeGraph,
} from './CreatureEdgeGraph.js';
export {
  type CreatureState,
  type CreatureMood,
  type CreatureSimConfig,
  DEFAULT_SIM_CONFIG,
  mergeSimConfig,
} from './CreatureState.js';
export type {
  InteractionEdge,
  InteractionOutcome,
  InteractionConditionFn,
} from './CreatureInteractionGraph.js';
