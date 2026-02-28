import { WorkflowManager } from '../../src/services/workflow-manager.service';
import { WorkflowRegistry } from '../../src/services/workflow-registry.service';
import { IWorkflowDbAdapter } from '../../src/interfaces/workflow-db-adapter.interface';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowEventType } from '../../src/events/workflow-event-type.enum';
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_TIMEOUT_EVENT,
} from '../../src/workflow.constants';
import { createMockRegistry, createMockAdapter } from '../helpers';
import type { DurableWorkflowDefinition } from '../../src/interfaces/durable-workflow-definition.interface';

const simpleMachine: DurableWorkflowDefinition = {
  id: 'simple',
  initial: 'idle',
  context: { value: 'test' },
  states: {
    idle: { on: { START: 'active' } },
    active: { on: { COMPLETE: 'done' } },
    done: { final: true },
  },
};

function createManager(
  adapter: IWorkflowDbAdapter,
  eventEmitter?: EventEmitter2,
): { manager: WorkflowManager; registry: WorkflowRegistry } {
  const registry = createMockRegistry();
  registry.register('orders', simpleMachine, class OrderWorkflow {});

  const manager = new WorkflowManager(
    registry,
    adapter,
    eventEmitter ?? new EventEmitter2(),
    {
      maxTransitionDepth: DEFAULT_MAX_DEPTH,
      timeoutEventType: DEFAULT_TIMEOUT_EVENT,
    },
  );

  return { manager, registry };
}

describe('WorkflowManager.send() - persistence loop', () => {
  let adapter: jest.Mocked<IWorkflowDbAdapter>;
  let manager: WorkflowManager;

  beforeEach(() => {
    adapter = createMockAdapter();
    ({ manager } = createManager(adapter));
  });

  it('should create a new workflow and transition on first send', async () => {
    const result = await manager.send('orders', 'order-1', { type: 'START' });

    expect(result.stateValue).toBe('active');
    expect(result.id).toBe('order-1');
    expect(result.done).toBe(false);
    expect(result.transitionCount).toBeGreaterThanOrEqual(1);
  });

  it('should call transaction() wrapping all operations', async () => {
    await manager.send('orders', 'order-1', { type: 'START' });

    expect(adapter.transaction).toHaveBeenCalledTimes(1);
  });

  it('should call findOne with lock=true inside transaction', async () => {
    await manager.send('orders', 'order-1', { type: 'START' });

    expect(adapter.findOne).toHaveBeenCalledWith('orders', 'order-1', true);
  });

  it('should call upsertLive once with the settled state', async () => {
    await manager.send('orders', 'order-1', { type: 'START' });

    expect(adapter.upsertLive).toHaveBeenCalledTimes(1);
    expect(adapter.upsertLive).toHaveBeenCalledWith(
      'orders',
      'order-1',
      expect.objectContaining({
        stateValue: 'active',
        snapshot: expect.any(Object),
      }),
    );
  });

  it('should call insertHistory for the transition', async () => {
    await manager.send('orders', 'order-1', { type: 'START' });

    expect(adapter.insertHistory).toHaveBeenCalled();
    const historyCall = adapter.insertHistory.mock.calls[0];
    expect(historyCall[0]).toBe('orders');
    expect(historyCall[1]).toMatchObject({
      workflowId: 'order-1',
      eventType: 'START',
    });
  });

  it('should hydrate from existing snapshot on subsequent sends', async () => {
    // First send creates the workflow
    await manager.send('orders', 'order-1', { type: 'START' });

    // Get the snapshot that was persisted
    const persistedSnapshot = adapter.upsertLive.mock.calls[0][2].snapshot;

    // Mock adapter to return existing record
    adapter.findOne.mockResolvedValue({
      id: 'order-1',
      stateValue: 'active',
      snapshot: persistedSnapshot,
      expiresAt: null,
      updatedAt: new Date(),
    });

    adapter.upsertLive.mockClear();
    adapter.insertHistory.mockClear();

    // Second send transitions active -> done
    const result = await manager.send('orders', 'order-1', {
      type: 'COMPLETE',
    });

    expect(result.stateValue).toBe('done');
    expect(result.done).toBe(true);
    expect(adapter.upsertLive).toHaveBeenCalledTimes(1);
  });

  it('should return current state without history when event causes no transition', async () => {
    await manager.send('orders', 'order-1', { type: 'START' });

    const persistedSnapshot = adapter.upsertLive.mock.calls[0][2].snapshot;

    adapter.findOne.mockResolvedValue({
      id: 'order-1',
      stateValue: 'active',
      snapshot: persistedSnapshot,
      expiresAt: null,
      updatedAt: new Date(),
    });
    adapter.upsertLive.mockClear();
    adapter.insertHistory.mockClear();

    // START is not valid from 'active' state
    const result = await manager.send('orders', 'order-1', { type: 'START' });

    expect(result.stateValue).toBe('active');
    expect(result.transitionCount).toBe(0);
    expect(adapter.insertHistory).not.toHaveBeenCalled();
  });

  it('should emit workflow.created event for new instances', async () => {
    const emitter = new EventEmitter2();
    const emitSpy = jest.spyOn(emitter, 'emit');
    ({ manager } = createManager(adapter, emitter));

    await manager.send('orders', 'order-1', { type: 'START' });

    expect(emitSpy).toHaveBeenCalledWith(
      WorkflowEventType.CREATED,
      expect.objectContaining({
        workflowType: 'orders',
        instanceId: 'order-1',
      }),
    );
  });

  it('should emit workflow.transition event for each transition', async () => {
    const emitter = new EventEmitter2();
    const emitSpy = jest.spyOn(emitter, 'emit');
    ({ manager } = createManager(adapter, emitter));

    await manager.send('orders', 'order-1', { type: 'START' });

    expect(emitSpy).toHaveBeenCalledWith(
      WorkflowEventType.TRANSITION,
      expect.objectContaining({
        workflowType: 'orders',
        instanceId: 'order-1',
        fromState: expect.any(String),
        toState: 'active',
      }),
    );
  });
});
