export interface WorkflowEventPayload {
  type: string;
  [key: string]: unknown;
}

export interface WorkflowActionInput {
  context: Record<string, unknown>;
  event: WorkflowEventPayload;
  fromState: string;
  toState: string;
}

export type WorkflowGuard = (input: WorkflowActionInput) => boolean;
export type WorkflowAction = (
  input: WorkflowActionInput,
) => void | Promise<void>;

export interface TransitionConfig {
  /** Optional target state. If omitted, actions run without a state change. */
  target?: string;
  guard?: WorkflowGuard;
  actions?: WorkflowAction | WorkflowAction[];
}

export type TransitionRule = string | TransitionConfig;

export interface DurableStateDefinition {
  /** Final-state marker (preferred). */
  final?: boolean;
  /** Legacy compatibility marker accepted in definitions. */
  type?: 'final';
  timeoutMinutes?: number;
  on?: Record<string, TransitionRule | TransitionRule[]>;
  always?: TransitionRule | TransitionRule[];
  entry?: WorkflowAction | WorkflowAction[];
  exit?: WorkflowAction | WorkflowAction[];
}

export interface DurableWorkflowDefinition {
  id: string;
  initial: string;
  context: Record<string, unknown>;
  states: Record<string, DurableStateDefinition>;
}

export type WorkflowStatus = 'active' | 'done' | 'error';

export interface DurableSnapshotV1 {
  schema: 'durable-workflow-snapshot';
  version: 1;
  engine: 'js-state-machine';
  state: string;
  status: WorkflowStatus;
  context: Record<string, unknown>;
}
