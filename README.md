# nestjs-durable-workflows

[![CI](https://github.com/camcima/nestjs-durable-workflows/actions/workflows/ci.yml/badge.svg)](https://github.com/camcima/nestjs-durable-workflows/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/camcima/nestjs-durable-workflows/branch/main/graph/badge.svg)](https://codecov.io/gh/camcima/nestjs-durable-workflows)

A NestJS module for durable backend workflows with `javascript-state-machine` and PostgreSQL persistence.

Define workflow types with durable workflow definitions. The module handles transactional persistence, rehydration, transition history, timeout expiration, and concurrency control.

## Features

- Durable execution with transactional live-state + history persistence
- Awaitable event dispatch that resolves at stable state
- Full transition history (including internal always-transitions)
- Timeout expiration with cron-driven timeout event dispatch
- Row-level lock concurrency safety (`SELECT ... FOR UPDATE`)
- Adapter pattern (`Drizzle`, `Prisma` raw, `pg`)
- Migration generator for live/history schema

## Requirements

- Node.js >= 18
- NestJS >= 10
- `javascript-state-machine` >= 3.1
- PostgreSQL >= 15

## Installation

```bash
npm install nestjs-durable-workflows javascript-state-machine drizzle-orm @nestjs/schedule @nestjs/event-emitter
```

`@nestjs/common`, `@nestjs/core`, `rxjs`, and `reflect-metadata` are expected from your NestJS app.

## Quick Start

### 1. Define a Durable Workflow

```typescript
// src/order/order.definition.ts
import type { DurableWorkflowDefinition } from 'nestjs-durable-workflows';

export const orderDefinition: DurableWorkflowDefinition = {
  id: 'order',
  initial: 'idle',
  context: { assignedTo: null },
  states: {
    idle: {
      on: { START: 'picking' },
    },
    picking: {
      timeoutMinutes: 30,
      on: {
        ASSIGN: {
          target: 'assigned',
          actions: ({ context, event }) => {
            context.assignedTo = event.pickerId;
          },
        },
        TIMEOUT: 'expired',
      },
    },
    assigned: {
      timeoutMinutes: 60,
      on: {
        COMPLETE: 'done',
        TIMEOUT: 'expired',
      },
    },
    expired: { final: true },
    done: { final: true },
  },
};
```

### 2. Register Workflow Entity

```typescript
// src/order/order.workflow.ts
import { Injectable } from '@nestjs/common';
import { WorkflowEntity } from 'nestjs-durable-workflows';
import { orderDefinition } from './order.definition';

@WorkflowEntity({ definition: orderDefinition })
@Injectable()
export class OrderWorkflow {}
```

The table name is derived from class name (`OrderWorkflow` -> `order_workflows`) unless you pass `tableName` explicitly.

### 3. Register Module

```typescript
import { Module } from '@nestjs/common';
import {
  WorkflowModule,
  DrizzleWorkflowAdapter,
} from 'nestjs-durable-workflows';

@Module({
  imports: [
    WorkflowModule.forRoot({
      adapter: new DrizzleWorkflowAdapter(drizzleDb, 'order_workflows'),
    }),
  ],
  providers: [OrderWorkflow],
})
export class AppModule {}
```

### 4. Send Events

```typescript
import { Injectable } from '@nestjs/common';
import { WorkflowManager } from 'nestjs-durable-workflows';

@Injectable()
export class OrderService {
  constructor(private readonly workflows: WorkflowManager) {}

  start(orderId: string) {
    return this.workflows.send('order_workflows', orderId, { type: 'START' });
  }
}
```

`send()` returns a `WorkflowResult` with `stateValue`, `snapshot`, `transitionCount`, and `done`.

## Documentation

- [Architecture](./docs/architecture.md)
- [Configuration](./docs/configuration.md)
- [Database Adapters](./docs/database-adapters.md)
- [Events](./docs/events.md)
- [Timeouts](./docs/timeouts.md)
- [Migration Generator](./docs/migration-generator.md)
- [Error Handling](./docs/error-handling.md)
- [Testing](./docs/testing.md)
- [JS State Machine Migration Spec](./docs/js-state-machine-migration-spec.md)

## License

MIT
