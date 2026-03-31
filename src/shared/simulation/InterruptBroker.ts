import type { Interrupt, InterruptChoice, InterruptBroker } from './types.js';

/**
 * Manages human-in-the-loop interrupts.
 *
 * When a GraphEngine encounters a condition that requires human input,
 * it calls requestInterrupt(). The broker holds the interrupt and fires
 * onInterruptRequested. The caller (renderer, main process, etc.) resolves
 * via resolveInterrupt(), which merges the choice's state injection and
 * resumes the engine.
 *
 * Deadlines are NOT automatically enforced here — callers should set up
 * a timer if auto-dismissal is needed.
 */
export class InterruptBrokerImpl implements InterruptBroker {
  private active: Interrupt | null = null;
  onInterruptRequested: ((interrupt: Interrupt) => void) | null = null;

  requestInterrupt(interrupt: Interrupt): void {
    if (this.active) {
      console.warn('[InterruptBroker] Interrupt already active, overwriting.');
    }
    this.active = interrupt;
    this.onInterruptRequested?.(interrupt);
  }

  resolveInterrupt(id: string, choice: InterruptChoice): void {
    if (!this.active || this.active.id !== id) {
      console.warn('[InterruptBroker] resolveInterrupt called with wrong id:', id);
      return;
    }
    this.active = null;
  }

  dismissInterrupt(id: string): void {
    if (!this.active || this.active.id !== id) return;
    this.active = null;
  }

  getActiveInterrupt(): Interrupt | null {
    return this.active;
  }
}
