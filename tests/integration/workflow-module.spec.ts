import { Test, TestingModule } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { WorkflowModule } from '../../src/workflow.module';
import { WorkflowRegistry } from '../../src/services/workflow-registry.service';
import { WorkflowManager } from '../../src/services/workflow-manager.service';
import { WorkflowEntity } from '../../src/decorators/workflow-entity.decorator';
import { IWorkflowDbAdapter } from '../../src/interfaces/workflow-db-adapter.interface';
import type { DurableWorkflowDefinition } from '../../src/interfaces/durable-workflow-definition.interface';

const orderMachine: DurableWorkflowDefinition = {
  id: 'order',
  initial: 'idle',
  context: {},
  states: {
    idle: { on: { START: 'active' } },
    active: {},
  },
};

@WorkflowEntity({ definition: orderMachine })
@Injectable()
class OrderWorkflow {}

@WorkflowEntity({ tableName: 'custom_shipments', definition: orderMachine })
@Injectable()
class ShipmentWorkflow {}

function createMockAdapter(): IWorkflowDbAdapter {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    upsertLive: jest.fn().mockResolvedValue(undefined),
    insertHistory: jest.fn().mockResolvedValue(undefined),
    findExpired: jest.fn().mockResolvedValue([]),
    findByState: jest.fn().mockResolvedValue([]),
    transaction: jest
      .fn()
      .mockImplementation(async (cb) => cb(createMockAdapter())),
  };
}

describe('WorkflowModule integration', () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should bootstrap with forRoot and register decorated entities', async () => {
    module = await Test.createTestingModule({
      imports: [
        WorkflowModule.forRoot({
          adapter: createMockAdapter(),
        }),
      ],
      providers: [OrderWorkflow, ShipmentWorkflow],
    }).compile();

    await module.init();

    const registry = module.get<WorkflowRegistry>(WorkflowRegistry);
    expect(registry).toBeDefined();

    // OrderWorkflow should be auto-registered with derived name
    const orderReg = registry.get('order_workflows');
    expect(orderReg).toBeDefined();
    expect(orderReg!.tableName).toBe('order_workflows');
    expect(orderReg!.definition).toBe(orderMachine);

    // ShipmentWorkflow should be registered with explicit name
    const shipmentReg = registry.get('custom_shipments');
    expect(shipmentReg).toBeDefined();
    expect(shipmentReg!.tableName).toBe('custom_shipments');
  });

  it('should provide WorkflowManager via DI', async () => {
    module = await Test.createTestingModule({
      imports: [
        WorkflowModule.forRoot({
          adapter: createMockAdapter(),
        }),
      ],
    }).compile();

    await module.init();

    const manager = module.get<WorkflowManager>(WorkflowManager);
    expect(manager).toBeDefined();
  });

  it('should work with forRootAsync', async () => {
    const adapter = createMockAdapter();

    module = await Test.createTestingModule({
      imports: [
        WorkflowModule.forRootAsync({
          useFactory: () => ({
            adapter,
            cronExpression: '*/30 * * * * *',
            timeoutEventType: 'EXPIRE',
            maxTransitionDepth: 50,
          }),
        }),
      ],
      providers: [OrderWorkflow],
    }).compile();

    await module.init();

    const registry = module.get<WorkflowRegistry>(WorkflowRegistry);
    const orderReg = registry.get('order_workflows');
    expect(orderReg).toBeDefined();
  });

  it('should allow sending events through the fully wired module', async () => {
    const adapter = createMockAdapter();
    // Make transaction pass through to the same adapter
    (adapter.transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb(adapter),
    );

    module = await Test.createTestingModule({
      imports: [WorkflowModule.forRoot({ adapter })],
      providers: [OrderWorkflow],
    }).compile();

    await module.init();

    const manager = module.get<WorkflowManager>(WorkflowManager);
    const result = await manager.send('order_workflows', 'test-1', {
      type: 'START',
    });

    expect(result.stateValue).toBe('active');
    expect(adapter.upsertLive).toHaveBeenCalled();
  });
});
