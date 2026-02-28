import 'reflect-metadata';
import { WORKFLOW_ENTITY_METADATA } from '../../src/workflow.constants';
import type { DurableWorkflowDefinition } from '../../src/interfaces/durable-workflow-definition.interface';

// We need to import the decorator after it's created
// For now, we define what metadata we expect
const dummyMachine: DurableWorkflowDefinition = {
  id: 'test',
  initial: 'idle',
  context: {},
  states: { idle: {} },
};

describe('@WorkflowEntity decorator', () => {
  let WorkflowEntity: any;

  beforeAll(async () => {
    const mod = await import('../../src/decorators/workflow-entity.decorator');
    WorkflowEntity = mod.WorkflowEntity;
  });

  it('should set metadata with explicit tableName', () => {
    @WorkflowEntity({ tableName: 'orders', definition: dummyMachine })
    class OrderWorkflow {}

    const metadata = Reflect.getMetadata(
      WORKFLOW_ENTITY_METADATA,
      OrderWorkflow,
    );

    expect(metadata).toBeDefined();
    expect(metadata.tableName).toBe('orders');
    expect(metadata.definition).toBe(dummyMachine);
  });

  it('should derive tableName from class name when not provided', () => {
    @WorkflowEntity({ definition: dummyMachine })
    class ShippingWorkflow {}

    const metadata = Reflect.getMetadata(
      WORKFLOW_ENTITY_METADATA,
      ShippingWorkflow,
    );

    expect(metadata).toBeDefined();
    expect(metadata.tableName).toBe('shipping_workflows');
    expect(metadata.definition).toBe(dummyMachine);
  });

  it('should derive tableName for Entity suffix', () => {
    @WorkflowEntity({ definition: dummyMachine })
    class OrderEntity {}

    const metadata = Reflect.getMetadata(WORKFLOW_ENTITY_METADATA, OrderEntity);

    expect(metadata.tableName).toBe('order_entities');
  });

  it('should store the machine reference', () => {
    @WorkflowEntity({ tableName: 'test_table', definition: dummyMachine })
    class TestWorkflow {}

    const metadata = Reflect.getMetadata(
      WORKFLOW_ENTITY_METADATA,
      TestWorkflow,
    );

    expect(metadata.definition).toBe(dummyMachine);
  });
});
