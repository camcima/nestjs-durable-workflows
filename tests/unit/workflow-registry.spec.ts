import { WorkflowRegistry } from '../../src/services/workflow-registry.service';
import { WorkflowNotRegisteredError } from '../../src/errors/workflow-not-registered.error';
import { DuplicateRegistrationError } from '../../src/errors/duplicate-registration.error';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { DurableWorkflowDefinition } from '../../src/interfaces/durable-workflow-definition.interface';

const dummyMachine: DurableWorkflowDefinition = {
  id: 'test',
  initial: 'idle',
  context: {},
  states: { idle: {} },
};

class FakeWorkflow {}
class AnotherWorkflow {}

function createRegistry(): WorkflowRegistry {
  const mockDiscovery = {
    getProviders: () => [],
  } as unknown as DiscoveryService;
  const mockReflector = { get: () => undefined } as unknown as Reflector;
  return new WorkflowRegistry(mockDiscovery, mockReflector);
}

describe('WorkflowRegistry', () => {
  let registry: WorkflowRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('should register and retrieve a workflow by tableName', () => {
    registry.register('orders', dummyMachine, FakeWorkflow);

    const result = registry.get('orders');
    expect(result).toBeDefined();
    expect(result!.tableName).toBe('orders');
    expect(result!.definition).toBe(dummyMachine);
    expect(result!.targetClass).toBe(FakeWorkflow);
  });

  it('should return undefined for unregistered tableName', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should throw WorkflowNotRegisteredError from getOrThrow', () => {
    expect(() => registry.getOrThrow('missing')).toThrow(
      WorkflowNotRegisteredError,
    );
    expect(() => registry.getOrThrow('missing')).toThrow(
      'No workflow entity registered for table "missing".',
    );
  });

  it('should throw DuplicateRegistrationError on duplicate tableName', () => {
    registry.register('orders', dummyMachine, FakeWorkflow);

    expect(() =>
      registry.register('orders', dummyMachine, AnotherWorkflow),
    ).toThrow(DuplicateRegistrationError);
    expect(() =>
      registry.register('orders', dummyMachine, AnotherWorkflow),
    ).toThrow('Duplicate workflow table name "orders".');
  });

  it('should return all registrations via getAll', () => {
    registry.register('orders', dummyMachine, FakeWorkflow);
    registry.register('shipments', dummyMachine, AnotherWorkflow);

    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.tableName).sort()).toEqual(['orders', 'shipments']);
  });
});
