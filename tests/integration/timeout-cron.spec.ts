import { TimeoutCronService } from '../../src/services/timeout-cron.service';
import { WorkflowManager } from '../../src/services/workflow-manager.service';
import { WorkflowRegistry } from '../../src/services/workflow-registry.service';
import { IWorkflowDbAdapter } from '../../src/interfaces/workflow-db-adapter.interface';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { WorkflowEventType } from '../../src/events/workflow-event-type.enum';
import { DEFAULT_TIMEOUT_EVENT } from '../../src/workflow.constants';
import { createMockRegistry, createMockAdapter } from '../helpers';
import type { DurableWorkflowDefinition } from '../../src/interfaces/durable-workflow-definition.interface';

const simpleMachine: DurableWorkflowDefinition = {
  id: 'test',
  initial: 'active',
  context: {},
  states: {
    active: { on: { TIMEOUT: 'expired', START: 'active' } },
    expired: { final: true },
  },
};

function activeSnapshot() {
  return {
    schema: 'durable-workflow-snapshot',
    version: 1,
    engine: 'js-state-machine',
    state: 'active',
    status: 'active',
    context: {},
  } as const;
}

describe('TimeoutCronService', () => {
  let adapter: jest.Mocked<IWorkflowDbAdapter>;
  let registry: WorkflowRegistry;
  let manager: WorkflowManager;
  let cronService: TimeoutCronService;
  let emitter: EventEmitter2;
  let schedulerRegistry: SchedulerRegistry;

  beforeEach(() => {
    adapter = createMockAdapter();
    registry = createMockRegistry();
    registry.register('orders', simpleMachine, class OrderWorkflow {});

    emitter = new EventEmitter2();
    manager = new WorkflowManager(registry, adapter, emitter, {
      maxTransitionDepth: 100,
      timeoutEventType: DEFAULT_TIMEOUT_EVENT,
    });

    schedulerRegistry = new SchedulerRegistry();
    cronService = new TimeoutCronService(
      registry,
      manager,
      adapter,
      schedulerRegistry,
      emitter,
      {
        cronExpression: '*/60 * * * * *',
        timeoutEventType: DEFAULT_TIMEOUT_EVENT,
        enableTimeoutCron: true,
      },
    );
  });

  describe('onModuleInit', () => {
    it('should register cron job when enableTimeoutCron=true', () => {
      const addCronJobSpy = jest.spyOn(schedulerRegistry, 'addCronJob');

      cronService.onModuleInit();

      expect(addCronJobSpy).toHaveBeenCalledWith(
        'workflow-timeout',
        expect.any(Object),
      );

      const job = schedulerRegistry.getCronJob('workflow-timeout');
      job.stop();
      schedulerRegistry.deleteCronJob('workflow-timeout');
    });

    it('should not register cron job when enableTimeoutCron=false', () => {
      const disabledCronService = new TimeoutCronService(
        registry,
        manager,
        adapter,
        schedulerRegistry,
        emitter,
        {
          cronExpression: '*/60 * * * * *',
          timeoutEventType: DEFAULT_TIMEOUT_EVENT,
          enableTimeoutCron: false,
        },
      );
      const addCronJobSpy = jest.spyOn(schedulerRegistry, 'addCronJob');

      disabledCronService.onModuleInit();

      expect(addCronJobSpy).not.toHaveBeenCalled();
    });
  });

  it('should send timeout event to each expired instance', async () => {
    // Mock: findExpired returns two expired instances
    adapter.findExpired.mockResolvedValue([{ id: 'wf-1' }, { id: 'wf-2' }]);

    // Mock: findOne returns an active workflow for each
    adapter.findOne.mockResolvedValue({
      id: 'wf-1',
      stateValue: 'active',
      snapshot: activeSnapshot(),
      expiresAt: new Date(Date.now() - 60000),
      updatedAt: new Date(),
    });

    const sendSpy = jest.spyOn(manager, 'send');

    const summary = await cronService.processExpiredWorkflows();

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy).toHaveBeenCalledWith('orders', 'wf-1', {
      type: 'TIMEOUT',
    });
    expect(sendSpy).toHaveBeenCalledWith('orders', 'wf-2', {
      type: 'TIMEOUT',
    });
    expect(summary).toMatchObject({
      workflowTypesScanned: 1,
      expiredFound: 2,
      attempted: 2,
      succeeded: 2,
      failed: 0,
      failures: [],
    });
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should emit workflow.timeout.triggered for each processed instance', async () => {
    adapter.findExpired.mockResolvedValue([{ id: 'wf-1' }]);
    adapter.findOne.mockResolvedValue({
      id: 'wf-1',
      stateValue: 'active',
      snapshot: activeSnapshot(),
      expiresAt: new Date(Date.now() - 60000),
      updatedAt: new Date(),
    });

    const emitSpy = jest.spyOn(emitter, 'emit');

    const summary = await cronService.processExpiredWorkflows();

    expect(emitSpy).toHaveBeenCalledWith(
      WorkflowEventType.TIMEOUT_TRIGGERED,
      expect.objectContaining({
        workflowType: 'orders',
        instanceId: 'wf-1',
      }),
    );
    expect(summary.succeeded).toBe(1);
  });

  it('should keep send metrics when side effects fail', async () => {
    adapter.findExpired.mockResolvedValue([{ id: 'wf-1' }]);
    adapter.findOne.mockResolvedValue({
      id: 'wf-1',
      stateValue: 'active',
      snapshot: activeSnapshot(),
      expiresAt: new Date(Date.now() - 60000),
      updatedAt: new Date(),
    });

    const originalEmit = emitter.emit.bind(emitter);
    jest.spyOn(emitter, 'emit').mockImplementation((...emitArgs: any[]) => {
      const [event, ...args] = emitArgs;
      if (event === WorkflowEventType.TIMEOUT_TRIGGERED) {
        throw new Error('emitter failed');
      }
      return originalEmit(event, ...args);
    });

    const summary = await cronService.processExpiredWorkflows();

    expect(summary).toMatchObject({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      failures: [],
    });
  });

  it('should continue processing when one instance fails', async () => {
    adapter.findExpired.mockResolvedValue([{ id: 'wf-fail' }, { id: 'wf-ok' }]);

    // First call fails, second succeeds
    let callCount = 0;
    adapter.findOne.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('DB connection lost');
      }
      return {
        id: 'wf-ok',
        stateValue: 'active',
        snapshot: activeSnapshot(),
        expiresAt: new Date(Date.now() - 60000),
        updatedAt: new Date(),
      };
    });

    const sendSpy = jest.spyOn(manager, 'send');

    // Should not throw
    const summary = await cronService.processExpiredWorkflows();

    // Second instance should still have been attempted
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({
      workflowTypesScanned: 1,
      expiredFound: 2,
      attempted: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(summary.failures).toEqual([
      expect.objectContaining({
        workflowType: 'orders',
        instanceId: 'wf-fail',
        error: 'DB connection lost',
      }),
    ]);
  });

  it('should not process instances when none are expired', async () => {
    adapter.findExpired.mockResolvedValue([]);

    const sendSpy = jest.spyOn(manager, 'send');

    const summary = await cronService.processExpiredWorkflows();

    expect(sendSpy).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      workflowTypesScanned: 1,
      expiredFound: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      failures: [],
    });
  });
});
