# Error Handling

`nestjs-durable-workflows` defines three error classes for common failure scenarios. All are exported from the package root.

## Error Types

### `RecursiveTransitionError`

Thrown when the number of transitions in a single `send()` call exceeds `maxTransitionDepth`.

```typescript
import { RecursiveTransitionError } from 'nestjs-durable-workflows';
```

| Property     | Type     | Description                                                      |
| ------------ | -------- | ---------------------------------------------------------------- |
| `workflowId` | `string` | The workflow instance ID                                         |
| `depth`      | `number` | The number of transitions that occurred before the limit was hit |
| `maxDepth`   | `number` | The configured maximum depth                                     |

**When it happens:** Your state machine has always-transitions that form a loop:

```typescript
states: {
  stateA: { always: 'stateB' },
  stateB: { always: 'stateA' },  // infinite loop
}
```

**What to do:** Fix the state machine definition to eliminate the loop. If a deep but finite chain of always-transitions is intentional, increase `maxTransitionDepth` in the module options.

**Transaction safety:** The database transaction is rolled back. No corrupt state is persisted.

### `WorkflowNotRegisteredError`

Thrown when `send()` is called with a table name that doesn't match any registered workflow entity.

```typescript
import { WorkflowNotRegisteredError } from 'nestjs-durable-workflows';
```

| Property    | Type     | Description                                       |
| ----------- | -------- | ------------------------------------------------- |
| `tableName` | `string` | The table name that was not found in the registry |

**When it happens:**

```typescript
// No @WorkflowEntity with tableName 'invoices' exists
await manager.send('invoices', '123', { type: 'START' });
// => WorkflowNotRegisteredError: No workflow entity registered for table "invoices".
```

**What to do:**

1. Verify the table name matches what your `@WorkflowEntity` decorator produces
2. Ensure the decorated class is registered as a provider in a module that's imported
3. Check for typos in the table name

### `DuplicateRegistrationError`

Thrown at application startup when two `@WorkflowEntity` classes resolve to the same table name.

```typescript
import { DuplicateRegistrationError } from 'nestjs-durable-workflows';
```

| Property    | Type     | Description                         |
| ----------- | -------- | ----------------------------------- |
| `tableName` | `string` | The duplicated table name           |
| `class1`    | `string` | Name of the first registered class  |
| `class2`    | `string` | Name of the second registered class |

**When it happens:**

```typescript
@WorkflowEntity({ tableName: 'orders', definition: definitionA })
@Injectable()
export class OrderWorkflowA {}

@WorkflowEntity({ tableName: 'orders', definition: definitionB })
@Injectable()
export class OrderWorkflowB {}

// => DuplicateRegistrationError: Duplicate workflow table name "orders".
//    Both OrderWorkflowA and OrderWorkflowB are registered with the same table name.
```

**What to do:** Give each workflow entity a unique table name.

## Handling Errors in Application Code

### Catching Specific Errors

```typescript
import {
  WorkflowManager,
  RecursiveTransitionError,
  WorkflowNotRegisteredError,
} from 'nestjs-durable-workflows';

@Injectable()
export class OrderService {
  constructor(private readonly workflow: WorkflowManager) {}

  async processOrder(orderId: string) {
    try {
      return await this.workflow.send('order_workflows', orderId, {
        type: 'START',
      });
    } catch (error) {
      if (error instanceof WorkflowNotRegisteredError) {
        // Configuration problem -- log and alert
        this.logger.error(`Workflow type not registered: ${error.tableName}`);
        throw error;
      }
      if (error instanceof RecursiveTransitionError) {
        // State machine bug -- log details for debugging
        this.logger.error(
          `Infinite loop detected in workflow ${error.workflowId} ` +
            `at depth ${error.depth}/${error.maxDepth}`,
        );
        throw error;
      }
      // Database errors, unexpected errors
      throw error;
    }
  }
}
```

### NestJS Exception Filters

Map workflow errors to HTTP responses with an exception filter:

```typescript
import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import {
  WorkflowNotRegisteredError,
  RecursiveTransitionError,
} from 'nestjs-durable-workflows';

@Catch(WorkflowNotRegisteredError, RecursiveTransitionError)
export class WorkflowExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof WorkflowNotRegisteredError) {
      response.status(HttpStatus.NOT_FOUND).json({
        error: 'Workflow type not found',
        tableName: exception.tableName,
      });
    } else if (exception instanceof RecursiveTransitionError) {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Workflow encountered an infinite transition loop',
        workflowId: exception.workflowId,
      });
    }
  }
}
```

## Database Errors

Database errors (connection failures, constraint violations, lock timeouts) propagate as-is from the adapter. The library does not wrap them. Handle them with standard try/catch or NestJS exception filters.

Common scenarios:

| Error                       | Cause                                         | Resolution                                       |
| --------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Connection refused          | Database is down                              | Retry with backoff, check connection config      |
| Lock wait timeout           | Long-running transaction holding the row lock | Investigate the blocking transaction             |
| Unique constraint violation | Race condition on first `send()` for same ID  | Rare with row-level locking; retry the operation |

## Timeout Cron Error Resilience

The timeout cron service handles errors for individual instances gracefully:

- If sending a timeout event to one instance fails, the error is logged and processing continues with the next instance.
- The cron job itself is wrapped in a catch to prevent unhandled rejections from crashing the process.
- This means a single bad workflow instance cannot block timeout processing for all other instances.
- `processExpiredWorkflows()` also returns structured run statistics, including a `failures` array (`workflowType`, `instanceId`, `error`) that can be returned from an internal endpoint or emitted to metrics/logging systems.
