import { randomUUID } from 'crypto';
import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DrizzleWorkflowAdapter } from '../../src/adapters/drizzle-workflow.adapter';
import { generateMigration } from '../../src/cli/generate-migration';
import { getTestPostgresConfig } from '../postgres-test-config';

const TABLE_NAME = 'it_drizzle_adapter';
const dbConfig = getTestPostgresConfig();

describe('Integration: DrizzleWorkflowAdapter (real Postgres)', () => {
  let setupClient: Client;
  let pool: Pool;
  let adapter: DrizzleWorkflowAdapter;

  beforeAll(async () => {
    setupClient = new Client(dbConfig);
    await setupClient.connect();

    const migrationSql = generateMigration(TABLE_NAME);
    const upSection = migrationSql
      .split('-- migrate:down')[0]
      .replace('-- migrate:up', '');
    await setupClient.query(upSection);

    pool = new Pool(dbConfig);
    const db = drizzle(pool);
    adapter = new DrizzleWorkflowAdapter(db as any, TABLE_NAME);
  });

  beforeEach(async () => {
    await setupClient.query(
      `TRUNCATE TABLE ${TABLE_NAME}_history, ${TABLE_NAME}`,
    );
  });

  afterAll(async () => {
    await setupClient.query(`DROP TABLE IF EXISTS ${TABLE_NAME}_history`);
    await setupClient.query(`DROP TABLE IF EXISTS ${TABLE_NAME}`);
    await pool.end();
    await setupClient.end();
  });

  it('should upsert and find a workflow row', async () => {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    const snapshot = { value: 'active', context: { count: 1 } };

    await adapter.upsertLive(TABLE_NAME, id, {
      stateValue: 'active',
      snapshot,
      expiresAt,
    });

    const record = await adapter.findOne(TABLE_NAME, id);
    expect(record).not.toBeNull();
    expect(record!.id).toBe(id);
    expect(record!.stateValue).toBe('active');
    expect(record!.snapshot).toEqual(snapshot);
    expect(record!.expiresAt).not.toBeNull();

    await adapter.transaction(async (txAdapter) => {
      const locked = await txAdapter.findOne(TABLE_NAME, id, true);
      expect(locked).not.toBeNull();
      expect(locked!.id).toBe(id);
    });
  });

  it('should update existing row on upsert conflict', async () => {
    const id = randomUUID();
    await adapter.upsertLive(TABLE_NAME, id, {
      stateValue: 'active',
      snapshot: { value: 'active', context: {} },
      expiresAt: new Date(Date.now() + 60_000),
    });

    await adapter.upsertLive(TABLE_NAME, id, {
      stateValue: 'done',
      snapshot: { value: 'done', context: { finished: true } },
      expiresAt: null,
    });

    const updated = await adapter.findOne(TABLE_NAME, id);
    expect(updated).not.toBeNull();
    expect(updated!.stateValue).toBe('done');
    expect(updated!.snapshot).toEqual({
      value: 'done',
      context: { finished: true },
    });
    expect(updated!.expiresAt).toBeNull();
  });

  it('should insert history rows with JSONB payload', async () => {
    const id = randomUUID();
    await adapter.upsertLive(TABLE_NAME, id, {
      stateValue: 'idle',
      snapshot: { value: 'idle', context: {} },
      expiresAt: null,
    });

    await adapter.insertHistory(TABLE_NAME, {
      workflowId: id,
      fromState: 'idle',
      toState: 'active',
      eventType: 'START',
      eventPayload: { type: 'START', source: 'api' },
    });

    const rows = await setupClient.query(
      `SELECT workflow_id, from_state, to_state, event_type, event_payload
       FROM ${TABLE_NAME}_history WHERE workflow_id = $1`,
      [id],
    );

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      workflow_id: id,
      from_state: 'idle',
      to_state: 'active',
      event_type: 'START',
      event_payload: { type: 'START', source: 'api' },
    });
  });

  it('should find expired workflow IDs', async () => {
    const expiredId = randomUUID();
    const activeId = randomUUID();

    await adapter.upsertLive(TABLE_NAME, expiredId, {
      stateValue: 'active',
      snapshot: { value: 'active', context: {} },
      expiresAt: new Date(Date.now() - 60_000),
    });
    await adapter.upsertLive(TABLE_NAME, activeId, {
      stateValue: 'active',
      snapshot: { value: 'active', context: {} },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const expired = await adapter.findExpired(TABLE_NAME);
    const ids = expired.map((row) => row.id);
    expect(ids).toContain(expiredId);
    expect(ids).not.toContain(activeId);
  });

  it('should find workflows by state value', async () => {
    const activeId = randomUUID();
    const doneId = randomUUID();

    await adapter.upsertLive(TABLE_NAME, activeId, {
      stateValue: 'active',
      snapshot: { value: 'active', context: {} },
      expiresAt: null,
    });
    await adapter.upsertLive(TABLE_NAME, doneId, {
      stateValue: 'done',
      snapshot: { value: 'done', context: {} },
      expiresAt: null,
    });

    const activeRows = await adapter.findByState(TABLE_NAME, 'active');
    expect(activeRows.map((row) => row.id)).toContain(activeId);
    expect(activeRows.map((row) => row.id)).not.toContain(doneId);
  });

  it('should commit transaction changes', async () => {
    const id = randomUUID();

    await adapter.transaction(async (txAdapter) => {
      await txAdapter.upsertLive(TABLE_NAME, id, {
        stateValue: 'active',
        snapshot: { value: 'active', context: { tx: true } },
        expiresAt: null,
      });

      await txAdapter.insertHistory(TABLE_NAME, {
        workflowId: id,
        fromState: 'idle',
        toState: 'active',
        eventType: 'START',
        eventPayload: { type: 'START' },
      });
    });

    const record = await adapter.findOne(TABLE_NAME, id);
    expect(record).not.toBeNull();

    const historyCount = await setupClient.query(
      `SELECT COUNT(*)::int AS count FROM ${TABLE_NAME}_history WHERE workflow_id = $1`,
      [id],
    );
    expect(historyCount.rows[0].count).toBe(1);
  });

  it('should rollback transaction on error', async () => {
    const id = randomUUID();

    await expect(
      adapter.transaction(async (txAdapter) => {
        await txAdapter.upsertLive(TABLE_NAME, id, {
          stateValue: 'active',
          snapshot: { value: 'active', context: { tx: true } },
          expiresAt: null,
        });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    const record = await adapter.findOne(TABLE_NAME, id);
    expect(record).toBeNull();
  });
});
