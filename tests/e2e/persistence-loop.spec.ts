import { randomUUID } from 'crypto';
import { Client } from 'pg';
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

const orderMachine: DurableWorkflowDefinition = {
  id: 'order',
  initial: 'idle',
  context: {},
  states: {
    idle: { on: { START: 'picking' } },
    picking: {
      on: { PICK: 'shipping', TIMEOUT: 'expired' },
      timeoutMinutes: 60,
    },
    shipping: { on: { SHIP: 'done' } },
    done: { final: true },
    expired: { final: true },
  },
};

const TABLE_NAME = 'e2e_orders';
const dbConfig = getTestPostgresConfig();

describe('E2E: Persistence Loop', () => {
  let client: Client;
  let adapter: DrizzleWorkflowAdapter;
  let manager: WorkflowManager;
  let registry: WorkflowRegistry;

  beforeAll(async () => {
    client = new Client(dbConfig);
    await client.connect();

    // Create tables using migration generator
    const migrationSql = generateMigration(TABLE_NAME);
    const upSection = migrationSql
      .split('-- migrate:down')[0]
      .replace('-- migrate:up', '');
    await client.query(upSection);

    const db = drizzle(client);
    adapter = new DrizzleWorkflowAdapter(db as any, TABLE_NAME);

    registry = createMockRegistry();
    registry.register(TABLE_NAME, orderMachine, class E2EOrder {});

    manager = new WorkflowManager(registry, adapter, new EventEmitter2(), {
      maxTransitionDepth: DEFAULT_MAX_DEPTH,
      timeoutEventType: DEFAULT_TIMEOUT_EVENT,
    });
  });

  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS ${TABLE_NAME}_history`);
    await client.query(`DROP TABLE IF EXISTS ${TABLE_NAME}`);
    await client.end();
  });

  it('should persist workflow through full lifecycle', async () => {
    const id = randomUUID();

    // Create workflow with START
    const r1 = await manager.send(TABLE_NAME, id, { type: 'START' });
    expect(r1.stateValue).toBe('picking');
    expect(r1.transitionCount).toBe(1);

    // Verify live table
    const live1 = await adapter.findOne(TABLE_NAME, id);
    expect(live1).not.toBeNull();
    expect(live1!.stateValue).toBe('picking');
    expect(live1!.expiresAt).not.toBeNull();

    // Verify uuidv7() produced a valid UUID for history
    const historyResult = await client.query(
      `SELECT id, workflow_id, from_state, to_state, event_type FROM ${TABLE_NAME}_history WHERE workflow_id = $1 ORDER BY transitioned_at`,
      [id],
    );
    expect(historyResult.rows.length).toBe(1);
    expect(historyResult.rows[0].from_state).toBe('idle');
    expect(historyResult.rows[0].to_state).toBe('picking');
    expect(historyResult.rows[0].event_type).toBe('START');
    // UUID format check
    expect(historyResult.rows[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // Transition: PICK -> shipping
    const r2 = await manager.send(TABLE_NAME, id, { type: 'PICK' });
    expect(r2.stateValue).toBe('shipping');
    expect(r2.transitionCount).toBe(1);

    // Verify live table updated
    const live2 = await adapter.findOne(TABLE_NAME, id);
    expect(live2!.stateValue).toBe('shipping');
    expect(live2!.expiresAt).toBeNull(); // shipping has no timeout

    // Transition: SHIP -> done (final)
    const r3 = await manager.send(TABLE_NAME, id, { type: 'SHIP' });
    expect(r3.stateValue).toBe('done');

    // Verify full history
    const fullHistory = await client.query(
      `SELECT from_state, to_state, event_type FROM ${TABLE_NAME}_history WHERE workflow_id = $1 ORDER BY transitioned_at`,
      [id],
    );
    expect(fullHistory.rows).toEqual([
      { from_state: 'idle', to_state: 'picking', event_type: 'START' },
      { from_state: 'picking', to_state: 'shipping', event_type: 'PICK' },
      { from_state: 'shipping', to_state: 'done', event_type: 'SHIP' },
    ]);
  });

  it('should persist event_payload as JSONB', async () => {
    const id = randomUUID();
    await manager.send(TABLE_NAME, id, { type: 'START' });

    const result = await client.query(
      `SELECT event_payload FROM ${TABLE_NAME}_history WHERE workflow_id = $1`,
      [id],
    );
    expect(result.rows[0].event_payload).toEqual({ type: 'START' });
  });

  it('should find expired workflows', async () => {
    const id = randomUUID();
    await manager.send(TABLE_NAME, id, { type: 'START' });

    // Force expires_at to the past
    await client.query(
      `UPDATE ${TABLE_NAME} SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [id],
    );

    const expired = await adapter.findExpired(TABLE_NAME);
    expect(expired.map((e) => e.id)).toContain(id);
  });

  it('should find workflows by state', async () => {
    const id = randomUUID();
    await manager.send(TABLE_NAME, id, { type: 'START' });

    const results = await adapter.findByState(TABLE_NAME, 'picking');
    expect(results.some((r) => r.id === id)).toBe(true);
  });
});
