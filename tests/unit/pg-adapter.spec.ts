import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { PgWorkflowAdapter } from '../../src/adapters/pg-workflow.adapter';

function createQueryResult<T extends QueryResultRow>(
  rows: T[] = [],
  rowCount?: number,
): QueryResult<T> {
  return {
    rows,
    rowCount: rowCount ?? rows.length,
    command: '',
    oid: 0,
    fields: [],
  };
}

function createMockPool() {
  const query = jest.fn<Promise<QueryResult<any>>, [string, unknown[]?]>();
  const release = jest.fn();
  const clientQuery = jest.fn<
    Promise<QueryResult<any>>,
    [string, unknown[]?]
  >();
  const connect = jest.fn<Promise<PoolClient>, []>().mockResolvedValue({
    query: clientQuery as any,
    release,
  } as unknown as PoolClient);

  const pool = {
    query: query as any,
    connect,
  } as unknown as Pool;

  return { pool, query, connect, clientQuery, release };
}

describe('PgWorkflowAdapter', () => {
  it('should construct with a valid table name', () => {
    const { pool } = createMockPool();
    expect(() => new PgWorkflowAdapter(pool, 'orders')).not.toThrow();
  });

  it('should reject invalid default table names', () => {
    const { pool } = createMockPool();
    expect(() => new PgWorkflowAdapter(pool, 'orders; DROP TABLE')).toThrow(
      'Invalid table name',
    );
  });

  it('should reject invalid table names in method calls', async () => {
    const { pool, query } = createMockPool();
    const adapter = new PgWorkflowAdapter(pool, 'orders');

    await expect(adapter.findOne('orders; DROP TABLE', 'id-1')).rejects.toThrow(
      'Invalid table name',
    );
    expect(query).not.toHaveBeenCalled();
  });

  describe('findOne', () => {
    it('should return null when row not found', async () => {
      const { pool, query } = createMockPool();
      query.mockResolvedValueOnce(createQueryResult([]));
      const adapter = new PgWorkflowAdapter(pool, 'orders');

      const result = await adapter.findOne('orders', 'id-1');
      expect(result).toBeNull();
    });

    it('should parse row values into WorkflowRecord', async () => {
      const { pool, query } = createMockPool();
      query.mockResolvedValueOnce(
        createQueryResult([
          {
            id: 'id-1',
            state_value: 'active',
            snapshot: '{"value":"active","context":{"count":1}}',
            expires_at: '2025-01-01T01:00:00.000Z',
            updated_at: '2025-01-01T00:00:00.000Z',
          },
        ]),
      );
      const adapter = new PgWorkflowAdapter(pool, 'orders');

      const result = await adapter.findOne('orders', 'id-1', true);
      expect(result).toEqual({
        id: 'id-1',
        stateValue: 'active',
        snapshot: { value: 'active', context: { count: 1 } },
        expiresAt: new Date('2025-01-01T01:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      });
      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  it('should execute upsertLive query', async () => {
    const { pool, query } = createMockPool();
    query.mockResolvedValueOnce(createQueryResult([]));
    const adapter = new PgWorkflowAdapter(pool, 'orders');

    await adapter.upsertLive('orders', 'id-1', {
      stateValue: 'active',
      snapshot: { value: 'active', context: {} },
      expiresAt: null,
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('should execute insertHistory query', async () => {
    const { pool, query } = createMockPool();
    query.mockResolvedValueOnce(createQueryResult([]));
    const adapter = new PgWorkflowAdapter(pool, 'orders');

    await adapter.insertHistory('orders', {
      workflowId: 'id-1',
      fromState: 'idle',
      toState: 'active',
      eventType: 'START',
      eventPayload: { type: 'START' },
    });

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('should map findExpired rows', async () => {
    const { pool, query } = createMockPool();
    query.mockResolvedValueOnce(
      createQueryResult([{ id: 'id-1' }, { id: 'id-2' }]),
    );
    const adapter = new PgWorkflowAdapter(pool, 'orders');

    await expect(adapter.findExpired('orders')).resolves.toEqual([
      { id: 'id-1' },
      { id: 'id-2' },
    ]);
  });

  it('should map findByState rows', async () => {
    const { pool, query } = createMockPool();
    query.mockResolvedValueOnce(
      createQueryResult([
        {
          id: 'id-1',
          state_value: 'active',
          snapshot: { value: 'active', context: {} },
          expires_at: null,
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      ]),
    );
    const adapter = new PgWorkflowAdapter(pool, 'orders');

    await expect(adapter.findByState('orders', 'active')).resolves.toEqual([
      {
        id: 'id-1',
        stateValue: 'active',
        snapshot: { value: 'active', context: {} },
        expiresAt: null,
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    ]);
  });

  describe('transaction', () => {
    it('should BEGIN/COMMIT and release client', async () => {
      const { pool, connect, clientQuery, release } = createMockPool();
      clientQuery.mockResolvedValue(createQueryResult([]));
      const adapter = new PgWorkflowAdapter(pool, 'orders');

      const result = await adapter.transaction(async (txAdapter) => {
        await txAdapter.findExpired('orders');
        return 'ok';
      });

      expect(result).toBe('ok');
      expect(connect).toHaveBeenCalledTimes(1);
      expect(clientQuery).toHaveBeenCalledWith('BEGIN');
      expect(clientQuery).toHaveBeenCalledWith('COMMIT');
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('should ROLLBACK and release on error', async () => {
      const { pool, clientQuery, release } = createMockPool();
      clientQuery.mockResolvedValue(createQueryResult([]));
      const adapter = new PgWorkflowAdapter(pool, 'orders');

      await expect(
        adapter.transaction(async () => {
          throw new Error('forced rollback');
        }),
      ).rejects.toThrow('forced rollback');

      expect(clientQuery).toHaveBeenCalledWith('BEGIN');
      expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('should run callback directly when already tx-bound', async () => {
      const { pool, connect, clientQuery } = createMockPool();
      clientQuery.mockResolvedValue(createQueryResult([]));
      const txClient = {
        query: clientQuery as any,
        release: jest.fn(),
      } as unknown as PoolClient;
      const adapter = new PgWorkflowAdapter(pool, 'orders', txClient);

      const result = await adapter.transaction(async (txAdapter) => {
        await txAdapter.findExpired('orders');
        return 'ok';
      });

      expect(result).toBe('ok');
      expect(connect).not.toHaveBeenCalled();
      expect(clientQuery).toHaveBeenCalledTimes(1);
    });
  });
});
