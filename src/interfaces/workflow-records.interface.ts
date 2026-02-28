export interface WorkflowRecord {
  id: string;
  stateValue: string;
  snapshot: Record<string, unknown>;
  expiresAt: Date | null;
  updatedAt: Date;
}

export interface HistoryRecord {
  id: string;
  workflowId: string;
  fromState: string;
  toState: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  transitionedAt: Date;
}

export interface WorkflowResult {
  /** The workflow instance ID */
  id: string;
  /** The settled state value (dot-notation string) */
  stateValue: string;
  /** The full persisted snapshot */
  snapshot: Record<string, unknown>;
  /** Number of transitions that occurred (including always-transitions) */
  transitionCount: number;
  /** Whether the machine reached a final state */
  done: boolean;
}
