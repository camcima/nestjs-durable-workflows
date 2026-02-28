import type {
  DurableWorkflowDefinition,
  TransitionConfig,
  TransitionRule,
} from '../interfaces/durable-workflow-definition.interface';

function toRules(input?: TransitionRule | TransitionRule[]): TransitionRule[] {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

function toConfig(rule: TransitionRule): TransitionConfig {
  return typeof rule === 'string' ? { target: rule } : rule;
}

function assertTargetExists(
  definition: DurableWorkflowDefinition,
  target: string,
  stateName: string,
): void {
  if (!(target in definition.states)) {
    throw new Error(
      `Workflow definition ${definition.id}: state "${stateName}" targets unknown state "${target}"`,
    );
  }
}

export function validateWorkflowDefinition(
  definition: DurableWorkflowDefinition,
): void {
  if (!definition.id || typeof definition.id !== 'string') {
    throw new Error('Workflow definition id must be a non-empty string');
  }

  if (!definition.initial || typeof definition.initial !== 'string') {
    throw new Error(
      `Workflow definition ${definition.id}: initial state must be a non-empty string`,
    );
  }

  if (!(definition.initial in definition.states)) {
    throw new Error(
      `Workflow definition ${definition.id}: initial state "${definition.initial}" does not exist`,
    );
  }

  for (const [stateName, stateDef] of Object.entries(definition.states)) {
    if ('states' in (stateDef as Record<string, unknown>)) {
      throw new Error(
        `Workflow definition ${definition.id}: nested states are not supported (state "${stateName}")`,
      );
    }

    const allRules: TransitionRule[] = [];

    for (const rule of toRules(stateDef.always)) {
      allRules.push(rule);
    }

    if (stateDef.on) {
      for (const value of Object.values(stateDef.on)) {
        for (const rule of toRules(value)) {
          allRules.push(rule);
        }
      }
    }

    for (const rule of allRules) {
      const config = toConfig(rule);
      if (typeof config.target === 'string') {
        assertTargetExists(definition, config.target, stateName);
      }
    }

    if (
      stateDef.timeoutMinutes !== undefined &&
      (typeof stateDef.timeoutMinutes !== 'number' || stateDef.timeoutMinutes < 0)
    ) {
      throw new Error(
        `Workflow definition ${definition.id}: state "${stateName}" has invalid timeoutMinutes`,
      );
    }
  }
}
