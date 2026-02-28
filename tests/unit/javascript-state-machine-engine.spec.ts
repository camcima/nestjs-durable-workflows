import { RecursiveTransitionError } from '../../src/errors/recursive-transition.error';
import { JavascriptStateMachineEngine } from '../../src/engines/javascript-state-machine.engine';
import type { DurableWorkflowDefinition } from '../../src/interfaces/durable-workflow-definition.interface';

const engine = new JavascriptStateMachineEngine();

describe('JavascriptStateMachineEngine', () => {
  it('should process valid transition and return settled state', async () => {
    const definition: DurableWorkflowDefinition = {
      id: 'simple',
      initial: 'idle',
      context: {},
      states: {
        idle: { on: { START: 'active' } },
        active: {},
      },
    };

    const runtime = engine.createRuntime({
      definition,
      maxTransitionDepth: 10,
      workflowId: 'wf-1',
    });

    const result = await runtime.send({ type: 'START' });

    expect(result.stateValue).toBe('active');
    expect(result.done).toBe(false);
    expect(result.transitions).toEqual([
      { fromState: 'idle', toState: 'active' },
    ]);
  });

  it('should return no transition for no-op event', async () => {
    const definition: DurableWorkflowDefinition = {
      id: 'simple',
      initial: 'idle',
      context: {},
      states: {
        idle: { on: { START: 'active' } },
        active: {},
      },
    };

    const runtime = engine.createRuntime({
      definition,
      maxTransitionDepth: 10,
      workflowId: 'wf-1',
    });

    const result = await runtime.send({ type: 'UNKNOWN' });

    expect(result.stateValue).toBe('idle');
    expect(result.transitions).toEqual([]);
  });

  it('should drain always transitions to stable state', async () => {
    const definition: DurableWorkflowDefinition = {
      id: 'always',
      initial: 'idle',
      context: {},
      states: {
        idle: { on: { START: 'a' } },
        a: { always: 'b' },
        b: { always: 'c' },
        c: {},
      },
    };

    const runtime = engine.createRuntime({
      definition,
      maxTransitionDepth: 10,
      workflowId: 'wf-1',
    });

    const result = await runtime.send({ type: 'START' });

    expect(result.stateValue).toBe('c');
    expect(result.transitions).toEqual([
      { fromState: 'idle', toState: 'a' },
      { fromState: 'a', toState: 'b' },
      { fromState: 'b', toState: 'c' },
    ]);
  });

  it('should enforce recursion depth limit', async () => {
    const definition: DurableWorkflowDefinition = {
      id: 'loop',
      initial: 'idle',
      context: {},
      states: {
        idle: { on: { START: 'a' } },
        a: { always: 'b' },
        b: { always: 'a' },
      },
    };

    const runtime = engine.createRuntime({
      definition,
      maxTransitionDepth: 5,
      workflowId: 'wf-1',
    });

    await expect(runtime.send({ type: 'START' })).rejects.toThrow(
      RecursiveTransitionError,
    );
  });

  it('should await async actions', async () => {
    const steps: string[] = [];

    const definition: DurableWorkflowDefinition = {
      id: 'async',
      initial: 'idle',
      context: {},
      states: {
        idle: {
          on: {
            START: {
              target: 'active',
              actions: async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                steps.push('action-complete');
              },
            },
          },
        },
        active: {},
      },
    };

    const runtime = engine.createRuntime({
      definition,
      maxTransitionDepth: 10,
      workflowId: 'wf-1',
    });

    const result = await runtime.send({ type: 'START' });

    expect(result.stateValue).toBe('active');
    expect(steps).toEqual(['action-complete']);
  });

  it('should reject async guards by contract at runtime', async () => {
    const definition: DurableWorkflowDefinition = {
      id: 'guard',
      initial: 'idle',
      context: {},
      states: {
        idle: {
          on: {
            START: {
              target: 'active',
              guard: (() => Promise.resolve(true)) as never,
            },
          },
        },
        active: {},
      },
    };

    const runtime = engine.createRuntime({
      definition,
      maxTransitionDepth: 10,
      workflowId: 'wf-1',
    });

    await expect(runtime.send({ type: 'START' })).rejects.toThrow(
      'Guard',
    );
  });
});
