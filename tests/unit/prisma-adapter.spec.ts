import {
  PrismaRawExecutor,
  PrismaWorkflowAdapter,
} from '../../src/adapters/prisma-workflow.adapter';

function createMockPrismaClient() {
  const queryRawUnsafe = jest.fn().mockResolvedValue([]);
  const executeRawUnsafe = jest.fn().mockResolvedValue(0);
  const txQueryRawUnsafe = jest.fn().mockResolvedValue([]);
  const txExecuteRawUnsafe = jest.fn().mockResolvedValue(0);

  const txClient = {
    $queryRawUnsafe: txQueryRawUnsafe,
    $executeRawUnsafe: txExecuteRawUnsafe,
  };

  const transaction = jest
    .fn()
    .mockImplementation(async (cb: (tx: PrismaRawExecutor) => unknown) =>
      cb(txClient as PrismaRawExecutor),
    );

  const client = {
    $queryRawUnsafe: queryRawUnsafe,
    $executeRawUnsafe: executeRawUnsafe,
    $transaction: transaction,
  };

  return {
    client,
    queryRawUnsafe,
    executeRawUnsafe,
    transaction,
    txQueryRawUnsafe,
    txExecuteRawUnsafe,
  };
}

describe('PrismaWorkflowAdapter', () => {
  it('should construct with a valid table name', () => {
    const { client } = createMockPrismaClient();
    expect(() => new PrismaWorkflowAdapter(client, 'orders')).not.toThrow();
  });

  it('should reject invalid table names to prevent SQL injection', () => {
    const { client } = createMockPrismaClient();
    expect(
      () => new PrismaWorkflowAdapter(client, 'orders; DROP TABLE'),
    ).toThrow('Invalid table name');
    expect(() => new PrismaWorkflowAdapter(client, "orders' OR 1=1")).toThrow(
      'Invalid table name',
    );
  });

  it('should reject invalid table name in method calls', async () => {
    const { client, queryRawUnsafe } = createMockPrismaClient();
    const adapter = new PrismaWorkflowAdapter(client, 'orders');

    await expect(adapter.findOne('orders; DROP TABLE', 'id-1')).rejects.toThrow(
      'Invalid table name',
    );
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  describe('findOne', () => {
    it('should return null when no row is found', async () => {
      const { client } = createMockPrismaClient();
      const adapter = new PrismaWorkflowAdapter(client, 'orders');

      const record = await adapter.findOne('orders', 'id-1');
      expect(record).toBeNull();
    });

    it('should parse row values into WorkflowRecord', async () => {
      const { client, queryRawUnsafe } = createMockPrismaClient();
      const updatedAt = '2025-01-01T00:00:00.000Z';
      queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'id-1',
          state_value: 'active',
          snapshot: '{"value":"active","context":{"count":1}}',
          expires_at: null,
          updated_at: updatedAt,
        },
      ]);

      const adapter = new PrismaWorkflowAdapter(client, 'orders');
      const record = await adapter.findOne('orders', 'id-1', true);

      expect(record).toEqual({
        id: 'id-1',
        stateValue: 'active',
        snapshot: { value: 'active', context: { count: 1 } },
        expiresAt: null,
        updatedAt: new Date(updatedAt),
      });
      expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertLive', () => {
    it('should execute upsert query', async () => {
      const { client, executeRawUnsafe } = createMockPrismaClient();
      const adapter = new PrismaWorkflowAdapter(client, 'orders');

      await adapter.upsertLive('orders', 'id-1', {
        stateValue: 'active',
        snapshot: { value: 'active', context: {} },
        expiresAt: null,
      });

      expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
    });
  });

  describe('insertHistory', () => {
    it('should execute history insert query', async () => {
      const { client, executeRawUnsafe } = createMockPrismaClient();
      const adapter = new PrismaWorkflowAdapter(client, 'orders');

      await adapter.insertHistory('orders', {
        workflowId: 'id-1',
        fromState: 'idle',
        toState: 'active',
        eventType: 'START',
        eventPayload: { type: 'START' },
      });

      expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
    });
  });

  describe('findExpired', () => {
    it('should return only id fields', async () => {
      const { client, queryRawUnsafe } = createMockPrismaClient();
      queryRawUnsafe.mockResolvedValueOnce([{ id: 'id-1' }, { id: 'id-2' }]);
      const adapter = new PrismaWorkflowAdapter(client, 'orders');

      const result = await adapter.findExpired('orders');

      expect(result).toEqual([{ id: 'id-1' }, { id: 'id-2' }]);
    });
  });

  describe('findByState', () => {
    it('should map rows to WorkflowRecord[]', async () => {
      const { client, queryRawUnsafe } = createMockPrismaClient();
      queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'id-1',
          state_value: 'active',
          snapshot: { value: 'active', context: {} },
          expires_at: '2025-01-01T01:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      ]);
      const adapter = new PrismaWorkflowAdapter(client, 'orders');

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
    it('should create a tx-bound adapter inside $transaction callback', async () => {
      const { client, transaction, txQueryRawUnsafe } =
        createMockPrismaClient();
      const adapter = new PrismaWorkflowAdapter(client, 'orders');

      await adapter.transaction(async (txAdapter) => {
        await txAdapter.findExpired('orders');
        return 'ok';
      });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(txQueryRawUnsafe).toHaveBeenCalledTimes(1);
    });

    it('should execute callback directly when no $transaction runner exists', async () => {
      const txOnlyClient: PrismaRawExecutor = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      };
      const adapter = new PrismaWorkflowAdapter(txOnlyClient, 'orders');

      const result = await adapter.transaction(async () => 'ok');
      expect(result).toBe('ok');
    });
  });
});
