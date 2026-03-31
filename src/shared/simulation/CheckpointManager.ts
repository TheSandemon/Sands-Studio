import type { Checkpoint, CheckpointManagerOptions, BranchOptions, StateVector } from './types.js';
import type { SeededRandom } from './SeededRandom.js';

/**
 * Ring-buffer checkpoint manager.
 * Stores up to maxCheckpoints snapshots. Branches are kept in a separate
 * registry so rewinding never destroys history.
 */
export class CheckpointManager<S extends StateVector = StateVector> {
  private ring: Checkpoint<S>[] = [];
  private branchRegistry = new Map<string, Checkpoint<S>>();
  private head = 0;
  private tickCounter = 0;

  constructor(private opts: CheckpointManagerOptions<S>) {}

  /**
   * Capture a snapshot of the current state.
   * Returns the created Checkpoint.
   */
  checkpoint(state: S, tick: number, rng: SeededRandom, label?: string): Checkpoint<S> {
    const cp: Checkpoint<S> = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      tick,
      state: structuredClone(state) as S,
      rngSeed: rng.getSeed(),
      label,
    };

    if (this.ring.length < this.opts.maxCheckpoints) {
      this.ring.push(cp);
    } else {
      this.ring[this.head] = cp;
    }
    this.head = (this.head + 1) % this.opts.maxCheckpoints;
    this.tickCounter = tick;

    this.opts.onCheckpoint?.(cp);
    return cp;
  }

  /**
   * Restore state from a checkpoint (does NOT modify the ring — creates a new head).
   * Returns null if checkpoint not found.
   */
  rewind(checkpointId: string): Checkpoint<S> | null {
    const cp = this.find(checkpointId);
    if (!cp) return null;

    // Create a new checkpoint at current position that reverts to cp's state
    const revertCp: Checkpoint<S> = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      tick: cp.tick,
      state: structuredClone(cp.state) as S,
      rngSeed: cp.rngSeed,
      label: `rewind→${cp.tick}`,
    };

    // Overwrite current head with the revert snapshot
    if (this.ring.length < this.opts.maxCheckpoints) {
      this.ring.push(revertCp);
    } else {
      this.ring[this.head] = revertCp;
    }
    this.head = (this.head + 1) % this.opts.maxCheckpoints;
    return revertCp;
  }

  /**
   * Branch from a checkpoint — create a named alternate timeline.
   * The branch registry stores named snapshots that won't be overwritten.
   */
  branch(checkpointId: string, opts: BranchOptions<S>): Checkpoint<S> | null {
    const base = this.find(checkpointId);
    if (!base) return null;

    const branched: Checkpoint<S> = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      tick: base.tick,
      state: {
        ...structuredClone(base.state),
        ...opts.overrideState,
      } as S,
      rngSeed: base.rngSeed,
      label: opts.label ?? `branch-${Date.now()}`,
    };

    this.branchRegistry.set(branched.id, branched);
    return branched;
  }

  /** Remove a named branch checkpoint. */
  prune(checkpointId: string): void {
    this.branchRegistry.delete(checkpointId);
  }

  /** Returns all checkpoints (ring + branches), newest first by timestamp. */
  list(): Checkpoint<S>[] {
    const ringSnapshots = [...this.ring].sort((a, b) => b.timestamp - a.timestamp);
    const branches = [...this.branchRegistry.values()].sort(
      (a, b) => b.timestamp - a.timestamp
    );
    return [...ringSnapshots, ...branches];
  }

  private find(id: string): Checkpoint<S> | undefined {
    return this.ring.find((cp) => cp.id === id) ?? this.branchRegistry.get(id);
  }

  getCurrentTick(): number {
    return this.tickCounter;
  }
}
