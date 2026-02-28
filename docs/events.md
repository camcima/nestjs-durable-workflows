# Events

`nestjs-durable-workflows` emits events via `@nestjs/event-emitter` after every successful persistence operation. Events are emitted **after** the transaction commits, so listeners are guaranteed to observe committed state.

## Event Types

All event type strings are available as the `WorkflowEventType` enum:

```typescript
import { WorkflowEventType } from 'nestjs-durable-workflows';
```

| Enum Value          | String                       | When Emitted                                                                       |
| ------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `CREATED`           | `workflow.created`           | A new workflow instance is created (first `send()` for an unknown ID)              |
| `TRANSITION`        | `workflow.transition`        | A state transition occurs (one event per transition, including always-transitions) |
| `TIMEOUT_TRIGGERED` | `workflow.timeout.triggered` | The cron service sends a timeout event to an expired instance                      |
| `TRANSITION_ERROR`  | `workflow.transition.error`  | Reserved for future use                                                            |

## Event Payloads

### `WorkflowCreatedEvent`

Emitted once when a workflow instance is created.

```typescript
interface WorkflowCreatedEvent {
  workflowType: string; // table name (e.g., "order_workflows")
  instanceId: string; // workflow instance UUID
  initialState: string; // the state after the first event is processed
  timestamp: Date;
}
```

### `WorkflowTransitionEvent`

Emitted for every state transition. If a single `send()` call triggers multiple transitions (via always-transitions), multiple events are emitted -- one per transition.

```typescript
interface WorkflowTransitionEvent {
  workflowType: string; // table name
  instanceId: string; // workflow instance UUID
  fromState: string; // state before transition (dot-notation)
  toState: string; // state after transition (dot-notation)
  eventType: string; // the workflow event type (e.g., "START")
  eventPayload: Record<string, unknown>; // the full event object
  timestamp: Date;
}
```

### `WorkflowTimeoutTriggeredEvent`

Emitted by the cron service after successfully sending a timeout event.

```typescript
interface WorkflowTimeoutTriggeredEvent {
  workflowType: string; // table name
  instanceId: string; // workflow instance UUID
  state: string; // state at time of expiration
  expiredAt: Date; // when the timeout was triggered
  timestamp: Date;
}
```

## Listening to Events

Use the `@OnEvent` decorator from `@nestjs/event-emitter`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  WorkflowEventType,
  WorkflowTransitionEvent,
  WorkflowCreatedEvent,
  WorkflowTimeoutTriggeredEvent,
} from 'nestjs-durable-workflows';

@Injectable()
export class WorkflowListener {
  private readonly logger = new Logger(WorkflowListener.name);

  @OnEvent(WorkflowEventType.CREATED)
  onCreated(event: WorkflowCreatedEvent) {
    this.logger.log(`New workflow: ${event.workflowType}/${event.instanceId}`);
  }

  @OnEvent(WorkflowEventType.TRANSITION)
  onTransition(event: WorkflowTransitionEvent) {
    this.logger.log(
      `${event.workflowType}/${event.instanceId}: ` +
        `${event.fromState} -> ${event.toState} (${event.eventType})`,
    );
  }

  @OnEvent(WorkflowEventType.TIMEOUT_TRIGGERED)
  onTimeout(event: WorkflowTimeoutTriggeredEvent) {
    this.logger.warn(`Timeout: ${event.workflowType}/${event.instanceId}`);
  }
}
```

Register the listener as a provider in your module:

```typescript
@Module({
  providers: [WorkflowListener],
})
export class AppModule {}
```

## Filtering by Workflow Type

Events include the `workflowType` field (the table name), so you can filter events for specific workflow types:

```typescript
@OnEvent(WorkflowEventType.TRANSITION)
onOrderTransition(event: WorkflowTransitionEvent) {
  if (event.workflowType !== 'order_workflows') return;

  // Handle order-specific transitions
  if (event.toState === 'done') {
    this.notificationService.sendOrderComplete(event.instanceId);
  }
}
```

## Event Ordering

- `CREATED` is emitted before `TRANSITION` events for a new instance.
- `TRANSITION` events for always-transitions are emitted in order (A->B before B->C).
- All events for a single `send()` call are emitted synchronously after the transaction commits.

## Use Cases

| Use Case      | Event               | Example                                             |
| ------------- | ------------------- | --------------------------------------------------- |
| Audit logging | `TRANSITION`        | Write transitions to an external audit system       |
| Notifications | `TRANSITION`        | Send an email when an order reaches `shipped` state |
| Metrics       | `TRANSITION`        | Increment a counter for state-change throughput     |
| Alerting      | `TIMEOUT_TRIGGERED` | Notify ops when workflows time out                  |
| Analytics     | `CREATED`           | Track workflow creation rates                       |
