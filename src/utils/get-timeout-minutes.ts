import type { DurableWorkflowDefinition } from '../interfaces/durable-workflow-definition.interface';

/**
 * Calculates timeout expiry for the current state based on state-level
 * timeoutMinutes configuration.
 */
export function getTimeoutExpiry(
  definition: DurableWorkflowDefinition,
  stateValue: string,
  now?: Date,
): Date | null {
  const stateDef = definition.states[stateValue];
  if (!stateDef || typeof stateDef.timeoutMinutes !== 'number') {
    return null;
  }

  const baseTime = now ?? new Date();
  return new Date(baseTime.getTime() + stateDef.timeoutMinutes * 60 * 1000);
}
