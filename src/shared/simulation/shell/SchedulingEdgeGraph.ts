/**
 * SchedulingEdgeGraph — express agent scheduling modes as edge graphs.
 *
 * In this model, each agent role is a "node" in the graph.
 * Edges define who can act after whom, and under what conditions.
 *
 * The existing scheduling modes (orchestrated, round-robin, free-for-all)
 * are predefined graphs. Module authors can override with custom edges.
 *
 * Pseudo-nodes:
 *   '__start__'    — entry point, fires once at initialization
 *   '__orchestrator__' — represents the DM/orchestrator agent
 *   '__tick__'     — fires every global tick
 *   '__end__'      — marks end of a round
 */
import type { Edge, EvalContext, StateVector } from '../types.js';
import type { ShellSimState, AgentSimState } from './ShellSimState.js';

export type SchedulingEdge = Edge<ShellSimState>;

// ─── Condition helpers ───────────────────────────────────────────────────────

function orchestratorDone(s: ShellSimState): boolean {
  return s.completedTurns.length === s.totalAgents;
}

function pendingHas(agentId: string): (s: ShellSimState) => boolean {
  return (s: ShellSimState) => (s.pendingTurns[agentId] ?? 0) > 0;
}

function allAgentsDone(s: ShellSimState): boolean {
  return s.completedTurns.length >= s.totalAgents;
}

function isAgentStatus(
  agentId: string,
  status: AgentSimState['status'],
): (s: ShellSimState, _ctx: EvalContext) => boolean {
  return (s: ShellSimState) => s.agentStates[agentId]?.status === status;
}

// ─── Orchestrated graph (DM-driven) ─────────────────────────────────────────

/**
 * In orchestrated mode, the DM decides turn order via give_turn().
 * pendingTurns: agentId → number of turns queued for that agent.
 * completedTurns: agents that have acted this round.
 */
export const ORCHESTRATED_GRAPH: SchedulingEdge[] = [
  // Entry: DM goes first
  {
    id: 'start→orchestrator',
    from: '__start__',
    to: '__orchestrator__',
    condition: () => true,
    priority: 100,
  },
  // Orchestrator gives a turn to a pending agent
  {
    id: 'orchestrator→warrior',
    from: '__orchestrator__',
    to: 'warrior',
    condition: pendingHas('warrior'),
    eventType: 'turn_started',
    priority: 50,
  },
  {
    id: 'orchestrator→mage',
    from: '__orchestrator__',
    to: 'mage',
    condition: pendingHas('mage'),
    eventType: 'turn_started',
    priority: 50,
  },
  // Generic: orchestrator → any pending agent (dynamic agents)
  {
    id: 'orchestrator→any-agent',
    from: '__orchestrator__',
    to: '__any_pending__',
    condition: (s: ShellSimState) => Object.keys(s.pendingTurns).length > 0,
    eventType: 'turn_started',
    priority: 1,
  },
  // Agents return to orchestrator after completing
  {
    id: 'warrior→orchestrator',
    from: 'warrior',
    to: '__orchestrator__',
    condition: isAgentStatus('warrior', 'done'),
    eventType: 'turn_ended',
    priority: 40,
  },
  {
    id: 'mage→orchestrator',
    from: 'mage',
    to: '__orchestrator__',
    condition: isAgentStatus('mage', 'done'),
    eventType: 'turn_ended',
    priority: 40,
  },
  // Round end: orchestrator when all done → __end__
  {
    id: 'orchestrator→end',
    from: '__orchestrator__',
    to: '__end__',
    condition: allAgentsDone,
    eventType: 'round_ended',
    priority: 30,
  },
  // Loop back: end → tick → orchestrator for next round
  {
    id: 'end→tick',
    from: '__end__',
    to: '__tick__',
    condition: () => true,
    eventType: 'round_started',
    priority: 20,
  },
  {
    id: 'tick→orchestrator',
    from: '__tick__',
    to: '__orchestrator__',
    condition: () => true,
    priority: 100,
  },
];

// ─── Round-robin graph ────────────────────────────────────────────────────────

/**
 * In round-robin, agents act in a fixed order.
 * tickAgentIndex increments modulo totalAgents.
 */
export const ROUND_ROBIN_GRAPH: SchedulingEdge[] = [
  {
    id: 'start→tick',
    from: '__start__',
    to: '__tick__',
    condition: () => true,
    priority: 100,
  },
  // __tick__ → first agent (index 0)
  {
    id: 'tick→agent-0',
    from: '__tick__',
    to: 'agent-0',
    condition: (s: ShellSimState) => (s.tick % s.totalAgents) === 0,
    priority: 50,
  },
  // agent-N → agent-(N+1)
  {
    id: 'agent-0→agent-1',
    from: 'agent-0',
    to: 'agent-1',
    condition: isAgentStatus('agent-0', 'done'),
    priority: 40,
  },
  {
    id: 'agent-1→agent-2',
    from: 'agent-1',
    to: 'agent-2',
    condition: isAgentStatus('agent-1', 'done'),
    priority: 40,
  },
  // Last agent → __end__
  {
    id: 'agent-last→end',
    from: 'agent-last',
    to: '__end__',
    condition: (s: ShellSimState) =>
      isAgentStatus('agent-last', 'done')(s),
    priority: 40,
  },
  // __end__ → __tick__ for next round
  {
    id: 'end→tick',
    from: '__end__',
    to: '__tick__',
    condition: () => true,
    eventType: 'round_started',
    priority: 20,
  },
];

// ─── Free-for-all graph ──────────────────────────────────────────────────────

/**
 * In free-for-all, all non-orchestrator agents act simultaneously.
 * Their mutations are batched and resolved together.
 */
export const FREE_FOR_ALL_GRAPH: SchedulingEdge[] = [
  {
    id: 'start→tick',
    from: '__start__',
    to: '__tick__',
    condition: () => true,
    priority: 100,
  },
  // __tick__ fires all agents at once
  {
    id: 'tick→all-agents',
    from: '__tick__',
    to: '__all_agents__',
    condition: () => true,
    eventType: 'all_agents_acting',
    priority: 50,
  },
  // All agents resolve → __end__
  {
    id: 'all-agents→end',
    from: '__all_agents__',
    to: '__end__',
    condition: allAgentsDone,
    eventType: 'round_ended',
    priority: 30,
  },
  {
    id: 'end→tick',
    from: '__end__',
    to: '__tick__',
    condition: () => true,
    eventType: 'round_started',
    priority: 20,
  },
];

// ─── Scheduling → Graph mapping ───────────────────────────────────────────────

export function schedulingToGraph(
  mode: 'orchestrated' | 'round-robin' | 'free-for-all',
): { edges: SchedulingEdge[]; entryPoint: string } {
  switch (mode) {
    case 'orchestrated':
      return { edges: ORCHESTRATED_GRAPH, entryPoint: '__orchestrator__' };
    case 'round-robin':
      return { edges: ROUND_ROBIN_GRAPH, entryPoint: '__tick__' };
    case 'free-for-all':
      return { edges: FREE_FOR_ALL_GRAPH, entryPoint: '__tick__' };
  }
}
