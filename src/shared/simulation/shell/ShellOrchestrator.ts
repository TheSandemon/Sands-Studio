/**
 * ShellOrchestrator — GraphEngine wrapper for agent scheduling.
 *
 * Wraps the existing ModuleOrchestrator's scheduling logic with a
 * data-driven edge graph. The turn execution and AI tool-use loop
 * still run through ModuleOrchestrator; this layer decides *which
 * agent goes next* using the graph.
 *
 * Migration path:
 *  - ModuleManifest.graph.edges is absent → load predefined graph from scheduling enum
 *  - ModuleManifest.graph.edges is present → use those edges directly
 *  - ModuleOrchestrator.runLoop() is NOT modified — ShellOrchestrator hooks into it
 *
 * The ShellOrchestrator is instantiated alongside (not instead of) ModuleOrchestrator.
 * ModuleOrchestrator gets a new `schedulingGraph` field that it consults
 * instead of the hardcoded scheduling switch.
 */
import type {
  Edge,
  StateVector,
  SimulationEvent,
  Checkpoint,
  Interrupt,
  InterruptChoice,
} from '../types.js';
import { GraphEngine } from '../GraphEngine.js';
import { CheckpointManager } from '../CheckpointManager.js';
import { SeededRandom } from '../SeededRandom.js';
import type { ShellSimState, AgentSimState } from './ShellSimState.js';
import { createInitialShellState } from './ShellSimState.js';
import type { SchedulingEdge } from './SchedulingEdgeGraph.js';

// ─── Scheduling result ───────────────────────────────────────────────────────

export interface SchedulingDecision {
  nextAgentId: string | null; // null = no agent should act (round complete / waiting)
  edgeFired: SchedulingEdge | null;
  events: ShellEvent[];
  shouldEndRound: boolean;
}

export type ShellEvent = SimulationEvent;

// ─── ShellOrchestrator ──────────────────────────────────────────────────────

export class ShellOrchestrator {
  private engine: GraphEngine<ShellSimState, ShellEvent>;
  private rng: SeededRandom;
  private roundNumber = 0;

  // Maps role IDs to node IDs in the graph (graph uses 'warrior' node IDs directly)
  private roleToNode = new Map<string, string>();

  constructor(
    edges: SchedulingEdge[],
    entryPoint: string,
    agentIds: string[],
    orchestratorId?: string,
    seed?: number,
  ) {
    this.rng = new SeededRandom(seed ?? Date.now());
    const initialState = createInitialShellState(agentIds, orchestratorId);

    // Build node evaluators for each agent
    const nodes = buildSchedulingNodes(agentIds, orchestratorId);

    // Build graph edges
    const graphEdges: Edge<ShellSimState>[] = edges.map((e) => ({
      ...e,
      condition: e.condition as Edge<ShellSimState>['condition'],
      onTransition: e.onTransition as Edge<ShellSimState>['onTransition'],
    }));

    this.engine = new GraphEngine<ShellSimState, ShellEvent>(
      nodes,
      graphEdges,
      initialState,
      entryPoint,
      this.rng,
      new CheckpointManager<ShellSimState>({ maxCheckpoints: 100, autoCheckpointEveryNTicks: 0 }),
    );
  }

  // ─── Scheduling decision ─────────────────────────────────────────────────

  /**
   * Get the next scheduling decision.
   * Called by ModuleOrchestrator at each scheduling point.
   *
   * Returns which agent should act next, or null if the round is complete.
   */
  decide(): SchedulingDecision {
    const state = this.engine.getState();
    const events: ShellEvent[] = [];

    // Advance the graph one tick
    const result = this.engine.tick(0); // deltaMs=0 for scheduling decisions
    events.push(...result.events);

    const nextId = state.activeAgentId;
    const edgeFired = result.events[0]
      ? (this.engine['edges'].find(
          (e) => e.id === result.events[0].data?.['edgeId'],
        ) ?? null)
      : null;

    return {
      nextAgentId: nextId,
      edgeFired: edgeFired as SchedulingEdge | null,
      events,
      shouldEndRound: nextId === '__end__' || nextId === null,
    };
  }

  /**
   * Called by ModuleOrchestrator when an agent completes its turn.
   * Updates the agent's status in the scheduling state.
   */
  onAgentTurnComplete(
    agentId: string,
    result: { success: boolean; error?: string },
  ): void {
    const state = this.engine.getState();
    if (!state.agentStates[agentId]) return;

    state.agentStates[agentId] = {
      ...state.agentStates[agentId],
      status: result.success ? 'done' : 'error',
      lastResult: result,
      requestCountThisRound: state.agentStates[agentId].requestCountThisRound + 1,
      requestCountTotal: state.agentStates[agentId].requestCountTotal + 1,
    };

    // Mark as completed this round
    if (!state.completedTurns.includes(agentId)) {
      state.completedTurns.push(agentId);
    }
  }

  /**
   * Called by the DM agent's give_turn tool.
   * Adds a pending turn for the specified agent.
   */
  giveTurn(agentId: string, count = 1): void {
    const state = this.engine.getState();
    state.pendingTurns[agentId] = (state.pendingTurns[agentId] ?? 0) + count;
  }

  /**
   * Called by the DM agent's end_round tool.
   * Resets the round state for the next round.
   */
  endRound(): void {
    const state = this.engine.getState();
    state.completedTurns = [];
    state.pendingTurns = {};
    state.roundNumber++;
    this.roundNumber++;
  }

  /**
   * Lock/unlock scheduling globally (used during pause).
   */
  setGlobalLock(locked: boolean): void {
    this.engine.getState().globalLock = locked;
  }

  // ─── Graph mutation (dynamic topology) ─────────────────────────────────────

  addEdge(edge: SchedulingEdge): void {
    this.engine.addEdge(edge as Edge<ShellSimState>);
  }

  removeEdge(edgeId: string): void {
    this.engine.removeEdge(edgeId);
  }

  addAgentNode(roleId: string): void {
    this.engine.addNode(roleId, {
      evaluate: (state, _ctx) => ({
        state,
        events: [],
        activeNodeId: roleId,
      }),
    });
  }

  // ─── Time-travel ─────────────────────────────────────────────────────────

  checkpoint(label?: string): Checkpoint<ShellSimState> {
    return this.engine.checkpoint(label);
  }

  rewind(checkpointId: string): boolean {
    return this.engine.rewind(checkpointId);
  }

  branch(checkpointId: string, label?: string): string {
    return this.engine.branch(checkpointId, label);
  }

  getTimeline(): Checkpoint<ShellSimState>[] {
    return this.engine.getCheckpointHistory();
  }

  // ─── State access ─────────────────────────────────────────────────────────

  getState(): Readonly<ShellSimState> {
    return this.engine.getState();
  }

  getRoundNumber(): number {
    return this.roundNumber;
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  serialize(): { state: ShellSimState; rngSeed: number; roundNumber: number } {
    return {
      state: this.engine.getState(),
      rngSeed: this.engine['rng'].getSeed(),
      roundNumber: this.roundNumber,
    };
  }
}

// ─── Node evaluators ────────────────────────────────────────────────────────

function buildSchedulingNodes(
  agentIds: string[],
  _orchestratorId?: string,
): Record<string, import('../types.js').NodeEvaluator<ShellSimState, ShellEvent>> {
  const nodes: Record<string, import('../types.js').NodeEvaluator<ShellSimState, ShellEvent>> = {
    __orchestrator__: {
      evaluate: (state, _ctx) => ({
        state,
        events: [],
        activeNodeId: state.activeAgentId ?? '__orchestrator__',
      }),
    },
    __tick__: {
      evaluate: (state, _ctx) => ({
        state,
        events: [{ type: 'tick', nodeId: '__tick__', tick: state.tick, data: {} }],
        activeNodeId: '__tick__',
      }),
    },
    __end__: {
      evaluate: (state, _ctx) => ({
        state,
        events: [{ type: 'round_end', nodeId: '__end__', tick: state.tick, data: {} }],
        activeNodeId: '__end__',
      }),
    },
    __all_agents__: {
      evaluate: (state, _ctx) => ({
        state,
        events: agentIds.map((id) => ({
          type: 'all_agents_act',
          nodeId: id,
          tick: state.tick,
          data: {},
        })) as ShellEvent[],
        activeNodeId: '__all_agents__',
      }),
    },
    __any_pending__: {
      evaluate: (state, _ctx) => {
        const pendingId = Object.keys(state.pendingTurns)[0];
        if (pendingId) {
          return {
            state: { ...state, activeAgentId: pendingId },
            events: [{ type: 'turn_started', nodeId: pendingId, tick: state.tick, data: {} }],
            activeNodeId: pendingId,
          };
        }
        return { state, events: [], activeNodeId: '__orchestrator__' };
      },
    },
  };

  // Add one node per agent
  for (const id of agentIds) {
    nodes[id] = {
      evaluate: (state, _ctx) => ({
        state: { ...state, activeAgentId: id },
        events: [{ type: 'turn_started', nodeId: id, tick: state.tick, data: {} }],
        activeNodeId: id,
      }),
    };
  }

  return nodes;
}
