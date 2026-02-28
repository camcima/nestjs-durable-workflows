import { DrizzleWorkflowAdapter } from '../../src/adapters/drizzle-workflow.adapter';

// Mock Drizzle db that captures executed SQL
function createMockDrizzleDb() {
  const executedQueries: { sql: string; params: unknown[] }[] = [];

  const mockDb = {
    execute: jest.fn().mockImplementation((query: any) => {
      // Drizzle sql template tag produces objects with queryChunks
      // For testing, we capture and return empty results
      const sqlString =
        typeof query === 'string' ? query : (query?.toSQL?.()?.sql ?? '');
      const params =
        typeof query === 'string' ? [] : (query?.toSQL?.()?.params ?? []);
      executedQueries.push({ sql: sqlString, params });
      return Promise.resolve({ rows: [] });
    }),
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const txDb = createMockDrizzleDb();
      return cb(txDb.db);
    }),
    _executedQueries: executedQueries,
  };

  return { db: mockDb, executedQueries };
}

describe('DrizzleWorkflowAdapter', () => {
  it('should construct with a valid table name', () => {
    const { db } = createMockDrizzleDb();
    expect(() => new DrizzleWorkflowAdapter(db as any, 'orders')).not.toThrow();
  });

  it('should reject invalid table names to prevent SQL injection', () => {
    const { db } = createMockDrizzleDb();
    expect(
      () => new DrizzleWorkflowAdapter(db as any, 'orders; DROP TABLE'),
    ).toThrow('Invalid table name');
    expect(
      () => new DrizzleWorkflowAdapter(db as any, "orders' OR 1=1"),
    ).toThrow('Invalid table name');
  });

  it('should accept underscored table names', () => {
    const { db } = createMockDrizzleDb();
    expect(
      () => new DrizzleWorkflowAdapter(db as any, 'order_workflows'),
    ).not.toThrow();
  });

  it('should reject invalid table names in method calls', async () => {
    const { db, executedQueries } = createMockDrizzleDb();
    const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

    await expect(adapter.findOne('orders; DROP TABLE', 'id-1')).rejects.toThrow(
      'Invalid table name',
    );
    expect(executedQueries).toHaveLength(0);
  });

  describe('findOne', () => {
    it('should call execute for findOne without lock', async () => {
      const { db } = createMockDrizzleDb();
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      await adapter.findOne('orders', 'id-1');

      expect(db.execute).toHaveBeenCalled();
    });

    it('should call execute for findOne with lock=true', async () => {
      const { db } = createMockDrizzleDb();
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      await adapter.findOne('orders', 'id-1', true);

      expect(db.execute).toHaveBeenCalled();
    });

    it('should parse string snapshot values from row data', async () => {
      const db = {
        execute: jest.fn().mockResolvedValue({
          rows: [
            {
              id: 'id-1',
              state_value: 'active',
              snapshot: '{"value":"active","context":{"count":1}}',
              expires_at: '2025-01-01T01:00:00.000Z',
              updated_at: '2025-01-01T00:00:00.000Z',
            },
          ],
        }),
        transaction: jest.fn(),
      };
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      const result = await adapter.findOne('orders', 'id-1');
      expect(result).toEqual({
        id: 'id-1',
        stateValue: 'active',
        snapshot: { value: 'active', context: { count: 1 } },
        expiresAt: new Date('2025-01-01T01:00:00.000Z'),
        updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      });
    });
  });

  describe('upsertLive', () => {
    it('should call execute for upsertLive', async () => {
      const { db } = createMockDrizzleDb();
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      await adapter.upsertLive('orders', 'id-1', {
        stateValue: 'active',
        snapshot: { value: 'active', context: {} },
        expiresAt: null,
      });

      expect(db.execute).toHaveBeenCalled();
    });
  });

  describe('insertHistory', () => {
    it('should call execute for insertHistory', async () => {
      const { db } = createMockDrizzleDb();
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      await adapter.insertHistory('orders', {
        workflowId: 'id-1',
        fromState: 'idle',
        toState: 'active',
        eventType: 'START',
        eventPayload: { type: 'START' },
      });

      expect(db.execute).toHaveBeenCalled();
    });
  });

  describe('findExpired', () => {
    it('should call execute for findExpired', async () => {
      const { db } = createMockDrizzleDb();
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      await adapter.findExpired('orders');

      expect(db.execute).toHaveBeenCalled();
    });

    it('should handle unknown execute result shape', async () => {
      const db = {
        execute: jest.fn().mockResolvedValue(undefined),
        transaction: jest.fn(),
      };
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      await expect(adapter.findExpired('orders')).resolves.toEqual([]);
    });

    it('should handle execute result as an array', async () => {
      const db = {
        execute: jest.fn().mockResolvedValue([{ id: 'id-1' }, { id: 'id-2' }]),
        transaction: jest.fn(),
      };
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      await expect(adapter.findExpired('orders')).resolves.toEqual([
        { id: 'id-1' },
        { id: 'id-2' },
      ]);
    });
  });

  describe('findByState', () => {
    it('should call execute for findByState', async () => {
      const { db } = createMockDrizzleDb();
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      await adapter.findByState('orders', 'active');

      expect(db.execute).toHaveBeenCalled();
    });

    it('should parse string snapshot and expiresAt values', async () => {
      const db = {
        execute: jest.fn().mockResolvedValue({
          rows: [
            {
              id: 'id-1',
              state_value: 'active',
              snapshot: '{"value":"active","context":{}}',
              expires_at: '2025-01-01T01:00:00.000Z',
              updated_at: '2025-01-01T00:00:00.000Z',
            },
          ],
        }),
        transaction: jest.fn(),
      };
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      const result = await adapter.findByState('orders', 'active');
      expect(result).toEqual([
        {
          id: 'id-1',
          stateValue: 'active',
          snapshot: { value: 'active', context: {} },
          expiresAt: new Date('2025-01-01T01:00:00.000Z'),
          updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        },
      ]);
    });
  });

  describe('transaction', () => {
    it('should provide a new adapter instance bound to tx', async () => {
      const { db } = createMockDrizzleDb();
      const adapter = new DrizzleWorkflowAdapter(db as any, 'orders');

      let txAdapterInstance: any = null;
      await adapter.transaction(async (txAdapter) => {
        txAdapterInstance = txAdapter;
        return 'result';
      });

      expect(db.transaction).toHaveBeenCalled();
      // The callback should have received an adapter (not the same instance)
      expect(txAdapterInstance).not.toBe(adapter);
    });
  });
});
