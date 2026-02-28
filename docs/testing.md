# Testing

This guide covers how to test durable workflow definitions and runtime behavior.

## Definition-Level Unit Tests

Test workflow definitions directly through the runtime engine contract.

```ts
import { JavascriptStateMachineEngine } from 'nestjs-durable-workflows';

const engine = new JavascriptStateMachineEngine();

it('reaches expected state', async () => {
  const runtime = engine.createRuntime({
    definition: orderDefinition,
    workflowId: 'test-1',
    maxTransitionDepth: 100,
  });

  const result = await runtime.send({ type: 'START' });
  expect(result.stateValue).toBe('picking');
});
```

## WorkflowManager Integration Tests

Use a mocked `IWorkflowDbAdapter` to verify transactional behavior, history writes, and hydration.

```ts
const adapter = createMockAdapter();
adapter.transaction.mockImplementation(async (cb) => cb(adapter));

const manager = new WorkflowManager(registry, adapter, new EventEmitter2(), {
  maxTransitionDepth: 100,
  timeoutEventType: 'TIMEOUT',
});

const result = await manager.send('order_workflows', 'order-1', {
  type: 'START',
});
expect(result.transitionCount).toBeGreaterThan(0);
```

## Timeout Tests

Validate timeout flow by mocking `findExpired` and verifying timeout event dispatch and resulting transition.

## Concurrency Tests

Use E2E tests with real PostgreSQL to validate `FOR UPDATE` serialization under concurrent sends.

## Running Test Suites

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:coverage
```

## Docker-Based DB Tests

```bash
docker compose -f tests/e2e/docker-compose.yml up -d
docker compose -f tests/e2e/docker-compose.yml exec postgres pg_isready -U test
npm run test:integration
npm run test:e2e
docker compose -f tests/e2e/docker-compose.yml down
```

## Practical Tips

1. Assert both settled state and `transitionCount` for event chains.
2. Assert no history rows are written for no-op events.
3. Include invalid snapshot tests (non-V1 rejection).
4. Keep definition validation tests close to registration and decorator behavior.
