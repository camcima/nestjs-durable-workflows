import { InMemoryWorkflowAdapter } from '../../src/adapters/in-memory-workflow.adapter';
import type { HistoryRecord } from '../../src/interfaces/workflow-records.interface';

function readHistory(
  adapter: InMemoryWorkflowAdapter,
  tableName: string,
): HistoryRecord[] {
  const state = (
    adapter as unknown as {
      state: { historyByTable: Map<string, HistoryRecord[]> };
    }
  ).state;

  return state.historyByTable.get(tableName) ?? [];
}

describe('InMemoryWorkflowAdapter', () => {
  it('should construct with a valid table name', () => {
    expect(() => new InMemoryWorkflowAdapter('orders')).not.toThrow();
  });

  it('should reject invalid default table names', () => {
    expect(() => new InMemoryWorkflowAdapter('orders; DROP TABLE')).toThrow(
      'Invalid table name',
    );
  });

  it('should return null when row does not exist', async () => {
    const adapter = new InMemoryWorkflowAdapter('orders');

    await expect(adapter.findOne('orders', 'id-1')).resolves.toBeNull();
  });

  it('should upsert and find a workflow row', async () => {
    const adapter = new InMemoryWorkflowAdapter('orders');

    await adapter.upsertLive('orders', 'id-1', {
      stateValue: 'active',
      snapshot: { state: 'active', context: { count: 1 } },
      expiresAt: null,
    });

    const row = await adapter.findOne('orders', 'id-1');
    expect(row).not.toBeNull();
    expect(row!.id).toBe('id-1');
    expect(row!.stateValue).toBe('active');
    expect(row!.snapshot).toEqual({ state: 'active', context: { count: 1 } });
    expect(row!.updatedAt).toBeInstanceOf(Date);
  });

  it('should clone snapshots to avoid external mutations', async () => {
    const adapter = new InMemoryWorkflowAdapter('orders');
    const snapshot = { state: 'active', context: { count: 1 } };

    await adapter.upsertLive('orders', 'id-1', {
      stateValue: 'active',
      snapshot,
      expiresAt: null,
    });

    snapshot.context.count = 99;
    const firstRead = await adapter.findOne('orders', 'id-1');
    expect(firstRead!.snapshot).toEqual({
      state: 'active',
      context: { count: 1 },
    });

    (firstRead!.snapshot.context as { count: number }).count = 77;
    const secondRead = await adapter.findOne('orders', 'id-1');
    expect(secondRead!.snapshot).toEqual({
      state: 'active',
      context: { count: 1 },
    });
  });

  it('should insert history rows and clone payload', async () => {
    const adapter = new InMemoryWorkflowAdapter('orders');
    const payload = { type: 'START', source: 'api' };

    await adapter.insertHistory('orders', {
      workflowId: 'id-1',
      fromState: 'idle',
      toState: 'active',
      eventType: 'START',
      eventPayload: payload,
    });

    payload.source = 'mutated';
    const rows = readHistory(adapter, 'orders');

    expect(rows).toHaveLength(1);
    expect(rows[0].workflowId).toBe('id-1');
    expect(rows[0].fromState).toBe('idle');
    expect(rows[0].toState).toBe('active');
    expect(rows[0].eventType).toBe('START');
    expect(rows[0].eventPayload).toEqual({ type: 'START', source: 'api' });
    expect(rows[0].id).toEqual(expect.any(String));
    expect(rows[0].transitionedAt).toBeInstanceOf(Date);
  });

  it('should find expired rows only', async () => {
    const adapter = new InMemoryWorkflowAdapter('orders');

    await adapter.upsertLive('orders', 'expired', {
      stateValue: 'active',
      snapshot: { state: 'active', context: {} },
      expiresAt: new Date(Date.now() - 60_000),
    });
    await adapter.upsertLive('orders', 'future', {
      stateValue: 'active',
      snapshot: { state: 'active', context: {} },
      expiresAt: new Date(Date.now() + 60_000),
    });
    await adapter.upsertLive('orders', 'none', {
      stateValue: 'active',
      snapshot: { state: 'active', context: {} },
      expiresAt: null,
    });

    await expect(adapter.findExpired('orders')).resolves.toEqual([
      { id: 'expired' },
    ]);
  });

  it('should find rows by state value', async () => {
    const adapter = new InMemoryWorkflowAdapter('orders');

    await adapter.upsertLive('orders', 'id-1', {
      stateValue: 'active',
      snapshot: { state: 'active', context: {} },
      expiresAt: null,
    });
    await adapter.upsertLive('orders', 'id-2', {
      stateValue: 'done',
      snapshot: { state: 'done', context: {} },
      expiresAt: null,
    });

    const rows = await adapter.findByState('orders', 'active');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('id-1');
  });

  it('should commit transaction changes', async () => {
    const adapter = new InMemoryWorkflowAdapter('orders');

    await adapter.transaction(async (txAdapter) => {
      await txAdapter.upsertLive('orders', 'id-1', {
        stateValue: 'active',
        snapshot: { state: 'active', context: { tx: true } },
        expiresAt: null,
      });
      await txAdapter.insertHistory('orders', {
        workflowId: 'id-1',
        fromState: 'idle',
        toState: 'active',
        eventType: 'START',
        eventPayload: { type: 'START' },
      });
    });

    const row = await adapter.findOne('orders', 'id-1');
    expect(row).not.toBeNull();
    expect(row!.snapshot).toEqual({ state: 'active', context: { tx: true } });
    expect(readHistory(adapter, 'orders')).toHaveLength(1);
  });

  it('should rollback transaction changes on error', async () => {
    const adapter = new InMemoryWorkflowAdapter('orders');

    await expect(
      adapter.transaction(async (txAdapter) => {
        await txAdapter.upsertLive('orders', 'id-1', {
          stateValue: 'active',
          snapshot: { state: 'active', context: { tx: true } },
          expiresAt: null,
        });
        await txAdapter.insertHistory('orders', {
          workflowId: 'id-1',
          fromState: 'idle',
          toState: 'active',
          eventType: 'START',
          eventPayload: { type: 'START' },
        });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    await expect(adapter.findOne('orders', 'id-1')).resolves.toBeNull();
    expect(readHistory(adapter, 'orders')).toHaveLength(0);
  });

  it('should reject invalid table names in method calls', async () => {
    const adapter = new InMemoryWorkflowAdapter('orders');

    await expect(
      adapter.upsertLive('orders;DROP', 'id-1', {
        stateValue: 'active',
        snapshot: { state: 'active', context: {} },
        expiresAt: null,
      }),
    ).rejects.toThrow('Invalid table name');
  });
});
