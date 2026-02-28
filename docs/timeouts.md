# Timeouts

Timeouts are state-definition driven. Configure `timeoutMinutes` on any state that should expire.

## Definition Example

```ts
import type { DurableWorkflowDefinition } from 'nestjs-durable-workflows';

export const orderDefinition: DurableWorkflowDefinition = {
  id: 'order',
  initial: 'idle',
  context: {},
  states: {
    idle: { on: { START: 'picking' } },
    picking: {
      timeoutMinutes: 30,
      on: { TIMEOUT: 'expired' },
    },
    expired: { final: true },
  },
};
```

## Expiration Calculation

After each settled transition:

- If current state has `timeoutMinutes`: `expires_at = NOW() + timeoutMinutes`
- If not: `expires_at = NULL`

## Cron Processing

`TimeoutCronService` runs on configured schedule:

1. Scan registered workflow tables
2. Query rows where `expires_at < CURRENT_TIMESTAMP`
3. Dispatch configured timeout event via `WorkflowManager.send()`
4. Emit `workflow.timeout.triggered` on success
5. Continue processing even if individual rows fail

## Configuration

```ts
WorkflowModule.forRoot({
  adapter: myAdapter,
  cronExpression: '*/60 * * * * *',
  timeoutEventType: 'TIMEOUT',
  enableTimeoutCron: true,
});
```

- `cronExpression`: six-field cron (seconds included)
- `timeoutEventType`: event type dispatched on expiry
- `enableTimeoutCron`: disable to trigger manually

## Manual Triggering

Use `TimeoutCronService.processExpiredWorkflows()` when running cron externally.

```ts
@Post('timeouts/run')
runTimeouts() {
  return this.timeoutCron.processExpiredWorkflows();
}
```

## Resilience Guarantees

- Per-instance failures do not stop the full scan
- Cron callback errors are caught/logged
- Concurrency safety is preserved by `send()` row locking
- Timeout dispatches remain idempotent when state already moved

## Database Index Recommendation

```sql
CREATE INDEX idx_orders_expires_at
  ON orders (expires_at)
  WHERE expires_at IS NOT NULL;
```
