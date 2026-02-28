export interface WorkflowTransitionEvent {
  workflowType: string;
  instanceId: string;
  fromState: string;
  toState: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  timestamp: Date;
}

export interface WorkflowCreatedEvent {
  workflowType: string;
  instanceId: string;
  initialState: string;
  timestamp: Date;
}

export interface WorkflowTimeoutTriggeredEvent {
  workflowType: string;
  instanceId: string;
  state: string;
  expiredAt: Date;
  timestamp: Date;
}
