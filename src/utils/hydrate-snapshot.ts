import { InvalidSnapshotError } from '../errors/invalid-snapshot.error';
import type {
  DurableSnapshotV1,
  DurableWorkflowDefinition,
  WorkflowStatus,
} from '../interfaces/durable-workflow-definition.interface';

export interface HydratedRuntimeSeed {
  state: string;
  status: WorkflowStatus;
  context: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isFinalState(
  definition: DurableWorkflowDefinition,
  stateValue: string,
): boolean {
  const state = definition.states[stateValue];
  return Boolean(state?.final || state?.type === 'final');
}

export function hydrateSnapshot(
  workflowId: string,
  definition: DurableWorkflowDefinition,
  snapshot?: Record<string, unknown>,
): HydratedRuntimeSeed {
  if (!snapshot) {
    return {
      state: definition.initial,
      status: isFinalState(definition, definition.initial) ? 'done' : 'active',
      context: deepClone(definition.context),
    };
  }

  const candidate = snapshot as Partial<DurableSnapshotV1>;

  if (
    candidate.schema !== 'durable-workflow-snapshot' ||
    candidate.version !== 1
  ) {
    throw new InvalidSnapshotError(
      workflowId,
      `Snapshot for workflow ${workflowId} is not a supported V1 durable snapshot`,
    );
  }

  if (candidate.engine !== 'js-state-machine') {
    throw new InvalidSnapshotError(
      workflowId,
      `Snapshot for workflow ${workflowId} has unsupported engine ${String(candidate.engine)}`,
    );
  }

  if (
    typeof candidate.state !== 'string' ||
    !(candidate.state in definition.states)
  ) {
    throw new InvalidSnapshotError(
      workflowId,
      `Snapshot for workflow ${workflowId} has invalid state ${String(candidate.state)}`,
    );
  }

  if (!isPlainObject(candidate.context)) {
    throw new InvalidSnapshotError(
      workflowId,
      `Snapshot for workflow ${workflowId} has invalid context payload`,
    );
  }

  const status = candidate.status;
  if (status !== 'active' && status !== 'done' && status !== 'error') {
    throw new InvalidSnapshotError(
      workflowId,
      `Snapshot for workflow ${workflowId} has invalid status ${String(status)}`,
    );
  }

  return {
    state: candidate.state,
    status,
    context: deepClone(candidate.context),
  };
}
