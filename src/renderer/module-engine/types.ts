// Re-export shared types
export type {
  WorldType, SchedulingMode, PacingConfig, RendererConfig,
  ModuleManifest, EntityState, GridPosition, FreeformPosition,
  Entity, Tile, GridWorld, FreeformWorld, GameEventType,
  GameEvent, AIProvider, AgentRole, AgentStatus, WorldState,
  ModuleRendererEvent, ModuleStatus, TaggedAsset, AssetRegistry,
  ActionResult, OrchestratorAction, AgentContext,
} from '../../shared/types'

// Renderer-only: serialized form for IPC and state management
export interface SerializedWorldState {
  tick: number
  entities: Entity[]
  worldType: WorldType
  grid?: import('../../shared/types').GridWorld
  freeform?: import('../../shared/types').FreeformWorld
  events: GameEvent[]
  round?: number
}
