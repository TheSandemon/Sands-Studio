/**
 * ShellSimState — simulation state for the agent scheduling graph.
 */
import type { StateVector } from '../types.js';

export interface ShellSimState extends StateVector {
  tick: number;
  activeAgentId: string | null;
  completedTurns: string[]; // agentIds that acted this round
  pendingTurns: Record<string, number>; // agentId → remaining turns to give
  roundNumber: number;
  totalAgents: number;
  globalLock: boolean;
  agentStates: Record<string, AgentSimState>;
}

export interface AgentSimState {
  roleId: string;
  status: 'idle' | 'thinking' | 'done' | 'error';
  lastResult: unknown;
  requestCountThisRound: number;
  requestCountTotal: number;
}

export function createInitialShellState(
  agentIds: string[],
  orchestratorId?: string,
): ShellSimState {
  return {
    tick: 0,
    activeAgentId: orchestratorId ?? null,
    completedTurns: [],
    pendingTurns: {},
    roundNumber: 0,
    totalAgents: agentIds.length,
    globalLock: false,
    agentStates: Object.fromEntries(
      agentIds.map((id) => [
        id,
        {
          roleId: id,
          status: 'idle' as const,
          lastResult: null,
          requestCountThisRound: 0,
          requestCountTotal: 0,
        },
      ])
    ),
  };
}
