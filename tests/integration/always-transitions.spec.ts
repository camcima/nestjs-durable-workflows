import { WorkflowManager } from '../../src/services/workflow-manager.service';
import { IWorkflowDbAdapter } from '../../src/interfaces/workflow-db-adapter.interface';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RecursiveTransitionError } from '../../src/errors/recursive-transition.error';
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_TIMEOUT_EVENT,
} from '../../src/workflow.constants';
import { createMockRegistry, createMockAdapter } from '../helpers';
import type { DurableWorkflowDefinition } from '../../src/interfaces/durable-workflow-definition.interface';

// Machine with always-transitions: idle -START-> A -always-> B -always-> C
const alwaysTransitionMachine: DurableWorkflowDefinition = {
  id: 'always',
  initial: 'idle',
  context: {},
  states: {
    idle: { on: { START: 'stateA' } },
    stateA: { always: 'stateB' },
    stateB: { always: 'stateC' },
    stateC: {},
  },
};

// Machine with infinite always-transition loop for recursion testing
const infiniteLoopMachine: DurableWorkflowDefinition = {
  id: 'infinite',
  initial: 'idle',
  context: { counter: 0 },
  states: {
    idle: { on: { START: 'loopA' } },
    loopA: {
      always: {
        target: 'loopB',
        actions: ({ context }) => {
          (context as { counter: number }).counter++;
        },
      },
    },
    loopB: {
      always: {
        target: 'loopA',
        actions: ({ context }) => {
          (context as { counter: number }).counter++;
        },
      },
    },
  },
};

describe('WorkflowManager - always-transition handling', () => {
  let adapter: jest.Mocked<IWorkflowDbAdapter>;

  beforeEach(() => {
    adapter = createMockAdapter();
  });

  it('should record separate history rows for A->B and B->C always-transitions', async () => {
    const registry = createMockRegistry();
    registry.register(
      'always_test',
      alwaysTransitionMachine,
      class AlwaysWorkflow {},
    );

    const manager = new WorkflowManager(
      registry,
      adapter,
      new EventEmitter2(),
      {
        maxTransitionDepth: DEFAULT_MAX_DEPTH,
        timeoutEventType: DEFAULT_TIMEOUT_EVENT,
      },
    );

    const result = await manager.send('always_test', 'wf-1', {
      type: 'START',
    });

    // Final settled state should be stateC
    expect(result.stateValue).toBe('stateC');

    // Should have multiple history entries capturing intermediate transitions
    // idle->stateA (event transition), stateA->stateB, stateB->stateC (always transitions)
    expect(adapter.insertHistory).toHaveBeenCalledTimes(3);

    const historyEntries = adapter.insertHistory.mock.calls.map((c) => ({
      from: c[1].fromState,
      to: c[1].toState,
    }));

    expect(historyEntries).toContainEqual({
      from: 'idle',
      to: 'stateA',
    });
    expect(historyEntries).toContainEqual({
      from: 'stateA',
      to: 'stateB',
    });
    expect(historyEntries).toContainEqual({
      from: 'stateB',
      to: 'stateC',
    });
  });

  it('should reflect final settled state C in upsertLive', async () => {
    const registry = createMockRegistry();
    registry.register(
      'always_test',
      alwaysTransitionMachine,
      class AlwaysWorkflow {},
    );

    const manager = new WorkflowManager(
      registry,
      adapter,
      new EventEmitter2(),
      {
        maxTransitionDepth: DEFAULT_MAX_DEPTH,
        timeoutEventType: DEFAULT_TIMEOUT_EVENT,
      },
    );

    await manager.send('always_test', 'wf-1', { type: 'START' });

    expect(adapter.upsertLive).toHaveBeenCalledWith(
      'always_test',
      'wf-1',
      expect.objectContaining({ stateValue: 'stateC' }),
    );
  });

  it('should throw RecursiveTransitionError when depth limit is exceeded', async () => {
    const registry = createMockRegistry();
    registry.register(
      'infinite_test',
      infiniteLoopMachine,
      class InfiniteWorkflow {},
    );

    const maxDepth = 10;
    const manager = new WorkflowManager(
      registry,
      adapter,
      new EventEmitter2(),
      { maxTransitionDepth: maxDepth, timeoutEventType: DEFAULT_TIMEOUT_EVENT },
    );

    await expect(
      manager.send('infinite_test', 'wf-1', { type: 'START' }),
    ).rejects.toThrow(RecursiveTransitionError);
  });

  it('should report correct transitionCount for always-transitions', async () => {
    const registry = createMockRegistry();
    registry.register(
      'always_test',
      alwaysTransitionMachine,
      class AlwaysWorkflow {},
    );

    const manager = new WorkflowManager(
      registry,
      adapter,
      new EventEmitter2(),
      {
        maxTransitionDepth: DEFAULT_MAX_DEPTH,
        timeoutEventType: DEFAULT_TIMEOUT_EVENT,
      },
    );

    const result = await manager.send('always_test', 'wf-1', {
      type: 'START',
    });

    // idle->A (event), A->B (always), B->C (always) = 3 transitions
    expect(result.transitionCount).toBe(3);
  });
});
