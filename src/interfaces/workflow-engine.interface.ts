import type {
  DurableSnapshotV1,
  DurableWorkflowDefinition,
  WorkflowEventPayload,
} from './durable-workflow-definition.interface';

export interface RuntimeTransition {
  fromState: string;
  toState: string;
}

export interface RuntimeSendResult {
  stateValue: string;
  done: boolean;
  transitions: RuntimeTransition[];
}

export interface RuntimeSnapshot {
  stateValue: string;
  done: boolean;
  context: Record<string, unknown>;
}

export interface IWorkflowRuntime {
  send(event: WorkflowEventPayload): Promise<RuntimeSendResult>;
  getSnapshot(): RuntimeSnapshot;
  dehydrate(): DurableSnapshotV1;
}

export interface CreateRuntimeInput {
  definition: DurableWorkflowDefinition;
  snapshot?: Record<string, unknown>;
  maxTransitionDepth: number;
  workflowId: string;
}

export interface IWorkflowEngine {
  createRuntime(input: CreateRuntimeInput): IWorkflowRuntime;
}
