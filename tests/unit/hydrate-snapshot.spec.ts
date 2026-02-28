import { InvalidSnapshotError } from '../../src/errors/invalid-snapshot.error';
import type { DurableWorkflowDefinition } from '../../src/interfaces/durable-workflow-definition.interface';
import {
  hydrateSnapshot,
  isFinalState,
} from '../../src/utils/hydrate-snapshot';

const definition: DurableWorkflowDefinition = {
  id: 'order',
  initial: 'idle',
  context: { count: 0 },
  states: {
    idle: {},
    active: {},
    done: { final: true },
  },
};

describe('hydrateSnapshot', () => {
  it('should return initial seed when snapshot is missing', () => {
    const seed = hydrateSnapshot('wf-1', definition);

    expect(seed).toEqual({
      state: 'idle',
      status: 'active',
      context: { count: 0 },
    });
  });

  it('should return done status when initial state is final', () => {
    const finalDef: DurableWorkflowDefinition = {
      ...definition,
      initial: 'done',
    };

    const seed = hydrateSnapshot('wf-1', finalDef);
    expect(seed.status).toBe('done');
  });

  it('should hydrate valid V1 snapshot', () => {
    const seed = hydrateSnapshot('wf-1', definition, {
      schema: 'durable-workflow-snapshot',
      version: 1,
      engine: 'js-state-machine',
      state: 'active',
      status: 'active',
      context: { count: 2 },
    });

    expect(seed).toEqual({
      state: 'active',
      status: 'active',
      context: { count: 2 },
    });
  });

  it('should reject non-V1 snapshot schema', () => {
    expect(() =>
      hydrateSnapshot('wf-1', definition, {
        schema: 'legacy',
        version: 1,
        engine: 'js-state-machine',
        state: 'active',
        status: 'active',
        context: {},
      }),
    ).toThrow(InvalidSnapshotError);
  });

  it('should reject unsupported state in snapshot', () => {
    expect(() =>
      hydrateSnapshot('wf-1', definition, {
        schema: 'durable-workflow-snapshot',
        version: 1,
        engine: 'js-state-machine',
        state: 'missing',
        status: 'active',
        context: {},
      }),
    ).toThrow(InvalidSnapshotError);
  });

  it('should reject invalid status in snapshot', () => {
    expect(() =>
      hydrateSnapshot('wf-1', definition, {
        schema: 'durable-workflow-snapshot',
        version: 1,
        engine: 'js-state-machine',
        state: 'active',
        status: 'unknown',
        context: {},
      }),
    ).toThrow(InvalidSnapshotError);
  });
});

describe('isFinalState', () => {
  it('should return true for state.final=true', () => {
    expect(isFinalState(definition, 'done')).toBe(true);
  });

  it('should return false for non-final state', () => {
    expect(isFinalState(definition, 'active')).toBe(false);
  });
});
