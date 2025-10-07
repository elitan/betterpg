/**
 * Rollback utility for managing multi-step operations
 * Ensures cleanup happens even if operations fail partway through
 */

export type RollbackStep = () => Promise<void>;

export class Rollback {
  private steps: RollbackStep[] = [];

  /**
   * Add a rollback step. Steps are executed in REVERSE order during rollback.
   */
  add(step: RollbackStep): void {
    this.steps.push(step);
  }

  /**
   * Execute all rollback steps in reverse order
   * Continues even if individual steps fail, logging errors
   */
  async execute(): Promise<void> {
    const errors: Error[] = [];

    // Execute in reverse order (LIFO)
    for (const step of this.steps.reverse()) {
      try {
        await step();
      } catch (error: any) {
        errors.push(error);
        console.error('Rollback step failed:', error.message);
      }
    }

    if (errors.length > 0) {
      console.warn(`Rollback completed with ${errors.length} error(s)`);
    }
  }

  /**
   * Clear all rollback steps (call after successful completion)
   */
  clear(): void {
    this.steps = [];
  }

  /**
   * Get number of registered rollback steps
   */
  get length(): number {
    return this.steps.length;
  }
}
