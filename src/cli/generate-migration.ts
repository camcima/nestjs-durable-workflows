#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

const TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function generateMigration(tableName: string): string {
  if (!TABLE_NAME_REGEX.test(tableName)) {
    throw new Error(
      `Invalid table name "${tableName}". Only alphanumeric characters and underscores are allowed.`,
    );
  }

  return `-- migrate:up
CREATE TABLE ${tableName} (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    state_value TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_${tableName}_expires_at
    ON ${tableName} (expires_at)
    WHERE expires_at IS NOT NULL;

CREATE INDEX idx_${tableName}_state_value
    ON ${tableName} (state_value);

CREATE INDEX idx_${tableName}_snapshot_gin
    ON ${tableName} USING gin (snapshot);

CREATE TABLE ${tableName}_history (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    workflow_id UUID NOT NULL REFERENCES ${tableName}(id),
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_payload JSONB NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_${tableName}_history_workflow_id
    ON ${tableName}_history (workflow_id);

CREATE INDEX idx_${tableName}_history_transitioned_at
    ON ${tableName}_history (transitioned_at);

CREATE INDEX idx_${tableName}_history_event_payload_gin
    ON ${tableName}_history USING gin (event_payload);

-- migrate:down
DROP TABLE IF EXISTS ${tableName}_history;
DROP TABLE IF EXISTS ${tableName};
`;
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(
      'Usage: nestjs-durable-workflows generate-migration <tableName>\n\n' +
        'Generates a dbmate-compatible SQL migration file for a workflow entity.\n\n' +
        'Arguments:\n' +
        '  tableName    The database table name (alphanumeric and underscores only)\n\n' +
        'Example:\n' +
        '  npx nestjs-durable-workflows generate-migration orders',
    );
    process.exit(args.length === 0 ? 1 : 0);
  }

  const command = args[0];
  if (command !== 'generate-migration') {
    console.error(`Unknown command: ${command}`);
    console.error('Available commands: generate-migration');
    process.exit(1);
  }

  const tableName = args[1];
  if (!tableName) {
    console.error('Error: tableName argument is required.');
    console.error(
      'Usage: nestjs-durable-workflows generate-migration <tableName>',
    );
    process.exit(1);
  }

  const sql = generateMigration(tableName);

  const migrationsDir = path.resolve('db', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const fileName = `${timestamp}_create_${tableName}.sql`;
  const filePath = path.join(migrationsDir, fileName);

  fs.writeFileSync(filePath, sql, 'utf-8');
  console.log(`Migration created: ${filePath}`);
}

if (require.main === module) {
  main();
}
