import { getTimeoutExpiry } from '../../src/utils/get-timeout-minutes';
import type { DurableWorkflowDefinition } from '../../src/interfaces/durable-workflow-definition.interface';

describe('getTimeoutExpiry', () => {
  it('should return a Date when state meta has timeoutMinutes', () => {
    const now = new Date('2026-02-20T12:00:00Z');
    const definition: DurableWorkflowDefinition = {
      id: 'order',
      initial: 'idle',
      context: {},
      states: {
        idle: {},
        picking: { timeoutMinutes: 30 },
      },
    };

    const result = getTimeoutExpiry(definition, 'picking', now);

    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(new Date('2026-02-20T12:30:00Z').getTime());
  });

  it('should return null when meta is empty', () => {
    const definition: DurableWorkflowDefinition = {
      id: 'order',
      initial: 'idle',
      context: {},
      states: { idle: {} },
    };
    const result = getTimeoutExpiry(definition, 'idle', new Date());
    expect(result).toBeNull();
  });

  it('should return null when meta exists but has no timeoutMinutes', () => {
    const definition: DurableWorkflowDefinition = {
      id: 'order',
      initial: 'idle',
      context: {},
      states: { picking: {} },
    };
    const result = getTimeoutExpiry(definition, 'picking', new Date());
    expect(result).toBeNull();
  });

  it('should use the first found timeoutMinutes when multiple meta entries exist', () => {
    const now = new Date('2026-02-20T12:00:00Z');
    const definition: DurableWorkflowDefinition = {
      id: 'order',
      initial: 'idle',
      context: {},
      states: {
        idle: {},
        picking: { timeoutMinutes: 60 },
      },
    };

    const result = getTimeoutExpiry(definition, 'picking', now);

    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(new Date('2026-02-20T13:00:00Z').getTime());
  });

  it('should default to current time when no now parameter is provided', () => {
    const definition: DurableWorkflowDefinition = {
      id: 'order',
      initial: 'idle',
      context: {},
      states: {
        idle: {},
        picking: { timeoutMinutes: 10 },
      },
    };
    const before = Date.now();
    const result = getTimeoutExpiry(definition, 'picking');
    const after = Date.now();

    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(result!.getTime()).toBeLessThanOrEqual(after + 10 * 60 * 1000);
  });
});
