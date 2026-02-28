# Architecture

`nestjs-durable-workflows` provides a durable workflow runtime for NestJS backed by PostgreSQL.

## Overview

At a high level, each `send()` call:

1. Opens a DB transaction
2. Loads the live workflow row with `FOR UPDATE`
3. Hydrates an ephemeral runtime instance from persisted snapshot (or definition initial state)
4. Processes the event to a stable state (including internal always-transitions)
5. Persists settled live state + transition history atomically
6. Emits lifecycle events after persistence

## Core Components

- `WorkflowManager`: dispatch orchestration and persistence loop
- `WorkflowRegistry`: workflow definition discovery/registration
- `TimeoutCronService`: expiration scanning and timeout dispatch
- `IWorkflowEngine`: runtime abstraction (default: `JavascriptStateMachineEngine`)
- `IWorkflowDbAdapter`: persistence abstraction for adapter implementations

## Runtime Model

- Runtime instances are ephemeral and created per `send()` call.
- Dispatch is awaitable and completes only when stable state is reached.
- Guards are synchronous.
- Actions may be asynchronous.
- Internal always-transitions are drained until quiescent.
- Recursive/internal transition loops are capped by `maxTransitionDepth`.

## Snapshot Model

The live row `snapshot` uses V1 durable envelope format:

```ts
{
  schema: 'durable-workflow-snapshot',
  version: 1,
  engine: 'js-state-machine',
  state: string,
  status: 'active' | 'done' | 'error',
  context: Record<string, unknown>
}
```

Non-V1 snapshots are rejected.

## Timeout Model

Timeout expiration is derived from current state definition (`timeoutMinutes`) after each settled transition.

- With timeout: `expires_at = now + timeoutMinutes`
- Without timeout: `expires_at = NULL`

`TimeoutCronService` scans expired rows and dispatches configured timeout events through `WorkflowManager.send()`.

## Concurrency Model

Concurrent sends for the same workflow ID are serialized by row-level locking:

```sql
SELECT ... FOR UPDATE
```

Conflict resolution is strict lock-acquisition order; no event-type prioritization.

## Persistence Pattern

Per successful dispatch:

- One live row upsert with settled state/snapshot/expiry
- One history row per transition in the dispatch chain
- Atomic commit or full rollback

## Events

After successful persistence, the module emits:

- `workflow.created`
- `workflow.transition`
- `workflow.timeout.triggered`

This guarantees listeners observe committed state.
