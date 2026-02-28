import { randomUUID } from 'crypto';
import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DrizzleWorkflowAdapter } from '../../src/adapters/drizzle-workflow.adapter';
import { WorkflowManager } from '../../src/services/workflow-manager.service';
import { WorkflowRegistry } from '../../src/services/workflow-registry.service';
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_TIMEOUT_EVENT,
} from '../../src/workflow.constants';
import { generateMigration } from '../../src/cli/generate-migration';
import { createMockRegistry } from '../helpers';
import type { DurableWorkflowDefinition } from '../../src/interfaces/durable-workflow-definition.interface';
import { getTestPostgresConfig } from '../postgres-test-config';

const counterMachine: DurableWorkflowDefinition = {
  id: 'counter',
  initial: 'active',
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: {
          actions: ({ context }) => {
            const typed = context as { count: number };
            typed.count += 1;
          },
        },
      },
    },
  },
};

const TABLE_NAME = 'e2e_concurrency';
const dbConfig = getTestPostgresConfig();

describe('E2E: Concurrency (FOR UPDATE lock)', () => {
  let setupClient: Client;
  let pool: Pool;
  let adapter: DrizzleWorkflowAdapter;
  let manager: WorkflowManager;
  let registry: WorkflowRegistry;

  beforeAll(async () => {
    // Setup client for DDL
    setupClient = new Client(dbConfig);
    await setupClient.connect();

    const migrationSql = generateMigration(TABLE_NAME);
    const upSection = migrationSql
      .split('-- migrate:down')[0]
      .replace('-- migrate:up', '');
    await setupClient.query(upSection);

    // Use a pool for concurrent connections
    pool = new Pool({
      ...dbConfig,
      max: 15,
    });

    const db = drizzle(pool);
    adapter = new DrizzleWorkflowAdapter(db as any, TABLE_NAME);

    registry = createMockRegistry();
    registry.register(TABLE_NAME, counterMachine, class E2EConcurrency {});

    manager = new WorkflowManager(registry, adapter, new EventEmitter2(), {
      maxTransitionDepth: DEFAULT_MAX_DEPTH,
      timeoutEventType: DEFAULT_TIMEOUT_EVENT,
    });
  });

  afterAll(async () => {
    await setupClient.query(`DROP TABLE IF EXISTS ${TABLE_NAME}_history`);
    await setupClient.query(`DROP TABLE IF EXISTS ${TABLE_NAME}`);
    await setupClient.end();
    await pool.end();
  });

  it('should handle 10 parallel sends without snapshot corruption', async () => {
    const id = randomUUID();
    const parallelCount = 10;

    // Create the workflow first
    await manager.send(TABLE_NAME, id, { type: 'INCREMENT' });

    // Run 10 parallel INCREMENT events
    const promises = Array.from({ length: parallelCount }, () =>
      manager.send(TABLE_NAME, id, { type: 'INCREMENT' }),
    );

    const results = await Promise.all(promises);

    // All should succeed (no corruption/errors)
    expect(results).toHaveLength(parallelCount);

    // Verify final state - count should be exactly 11 (1 initial + 10 parallel)
    const finalRecord = await adapter.findOne(TABLE_NAME, id);
    expect(finalRecord).not.toBeNull();
    expect(finalRecord!.snapshot.context).toEqual({ count: 11 });

    // Counter machine only mutates context (no state transitions from 'active'),
    // so no history rows are written (history tracks state changes, not context changes)
  }, 30000);

  it('should serialize concurrent access to the same workflow', async () => {
    const id = randomUUID();

    // Create the workflow
    await manager.send(TABLE_NAME, id, { type: 'INCREMENT' });

    // Run 5 parallel sends
    const promises = Array.from({ length: 5 }, () =>
      manager.send(TABLE_NAME, id, { type: 'INCREMENT' }),
    );

    await Promise.all(promises);

    const finalRecord = await adapter.findOne(TABLE_NAME, id);
    expect(finalRecord!.snapshot.context).toEqual({ count: 6 });
  }, 15000);
});
