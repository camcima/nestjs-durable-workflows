# Migration Generator

`nestjs-durable-workflows` includes a CLI command that generates [dbmate](https://github.com/amacneil/dbmate)-compatible SQL migration files.

## Usage

```bash
npx nestjs-durable-workflows generate-migration <tableName>
```

### Example

```bash
npx nestjs-durable-workflows generate-migration order_workflows
```

Output:

```
Migration created: db/migrations/20260220143000_create_order_workflows.sql
```

### Arguments

| Argument    | Description                                                                   |
| ----------- | ----------------------------------------------------------------------------- |
| `tableName` | The database table name. Must contain only letters, numbers, and underscores. |

### Help

```bash
npx nestjs-durable-workflows --help
```

## Generated Schema

The migration creates two tables, seven indexes, and a foreign key constraint.

### Live Table

```sql
CREATE TABLE order_workflows (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    state_value TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

| Column        | Type          | Description                                                                                                           |
| ------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`          | `UUID`        | Primary key. Uses native `uuidv7()` (time-ordered) on PostgreSQL 18+.                                                 |
| `state_value` | `TEXT`        | Flattened state path in dot-notation (e.g., `"picking.active"`). Denormalized for efficient SQL queries.              |
| `snapshot`    | `JSONB`       | Durable runtime snapshot envelope (`schema`, `version`, `engine`, `state`, `status`, `context`).                      |
| `expires_at`  | `TIMESTAMPTZ` | Calculated from state-level `timeoutMinutes`. `NULL` if the current state has no timeout.                             |
| `updated_at`  | `TIMESTAMPTZ` | Automatically updated on every write.                                                                                 |

### History Table

```sql
CREATE TABLE order_workflows_history (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    workflow_id UUID NOT NULL REFERENCES order_workflows(id),
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_payload JSONB NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

| Column            | Type          | Description                                                   |
| ----------------- | ------------- | ------------------------------------------------------------- |
| `id`              | `UUID`        | Primary key.                                                  |
| `workflow_id`     | `UUID`        | Foreign key to the live table.                                |
| `from_state`      | `TEXT`        | State before the transition (dot-notation).                   |
| `to_state`        | `TEXT`        | State after the transition (dot-notation).                    |
| `event_type`      | `TEXT`        | The event that triggered the transition (e.g., `"START"`).    |
| `event_payload`   | `JSONB`       | The full event object including type and any additional data. |
| `transitioned_at` | `TIMESTAMPTZ` | When the transition occurred.                                 |

### Indexes

| Index                               | Type           | Table   | Purpose                                                                          |
| ----------------------------------- | -------------- | ------- | -------------------------------------------------------------------------------- |
| `idx_{t}_expires_at`                | Partial B-tree | Live    | Fast expiration queries (`WHERE expires_at IS NOT NULL`)                         |
| `idx_{t}_state_value`               | B-tree         | Live    | `findByState()` queries                                                          |
| `idx_{t}_snapshot_gin`              | GIN            | Live    | JSON Path queries on snapshot context (e.g., `snapshot->'context'->>'priority'`) |
| `idx_{t}_history_workflow_id`       | B-tree         | History | Query history by workflow instance                                               |
| `idx_{t}_history_transitioned_at`   | B-tree         | History | Chronological ordering of transitions                                            |
| `idx_{t}_history_event_payload_gin` | GIN            | History | JSON Path queries on event data (e.g., `event_payload->>'sku'`)                  |

### Rollback

The migration includes a `migrate:down` section that drops both tables in the correct order (history table first due to the foreign key constraint):

```sql
-- migrate:down
DROP TABLE IF EXISTS order_workflows_history;
DROP TABLE IF EXISTS order_workflows;
```

## Output Location

Migrations are written to `db/migrations/` relative to the current working directory. The directory is created if it doesn't exist.

The filename format is `{timestamp}_create_{tableName}.sql`, where `{timestamp}` is `YYYYMMDDHHmmss`.

## Applying Migrations

Use [dbmate](https://github.com/amacneil/dbmate) to apply the generated migration:

```bash
# Set your database URL
export DATABASE_URL="postgres://user:pass@localhost:5432/mydb?sslmode=disable"

# Apply pending migrations
dbmate up

# Rollback the last migration
dbmate rollback
```

## Programmatic Usage

The `generateMigration` function is also exported for use in code:

```typescript
import { generateMigration } from 'nestjs-durable-workflows';

const sql = generateMigration('order_workflows');
console.log(sql);
```

This returns the full SQL string without writing any files.

## Querying the History Table

The GIN index on `event_payload` enables efficient JSONB queries. Some examples using PostgreSQL JSON Path expressions:

```sql
-- Find all transitions triggered by a specific SKU
SELECT * FROM order_workflows_history
WHERE event_payload->>'sku' = 'ABC-123';

-- Find all transitions with a payload containing a specific field
SELECT * FROM order_workflows_history
WHERE event_payload ? 'priority';

-- Full timeline for a workflow instance
SELECT from_state, to_state, event_type, transitioned_at
FROM order_workflows_history
WHERE workflow_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY transitioned_at;
```
