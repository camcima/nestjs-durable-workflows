import { DynamicModule, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { WorkflowManager } from './services/workflow-manager.service';
import { WorkflowRegistry } from './services/workflow-registry.service';
import { TimeoutCronService } from './services/timeout-cron.service';
import {
  WorkflowModuleOptions,
  WorkflowModuleAsyncOptions,
} from './interfaces/workflow-module-options.interface';
import {
  WORKFLOW_MODULE_OPTIONS,
  WORKFLOW_DB_ADAPTER,
  WORKFLOW_ENGINE,
  DEFAULT_CRON_EXPRESSION,
  DEFAULT_TIMEOUT_EVENT,
  DEFAULT_MAX_DEPTH,
} from './workflow.constants';
import { JavascriptStateMachineEngine } from './engines/javascript-state-machine.engine';

@Module({})
export class WorkflowModule {
  static forRoot(options: WorkflowModuleOptions): DynamicModule {
    return {
      module: WorkflowModule,
      imports: [
        DiscoveryModule,
        ScheduleModule.forRoot(),
        EventEmitterModule.forRoot(),
      ],
      providers: [
        {
          provide: WORKFLOW_DB_ADAPTER,
          useValue: options.adapter,
        },
        {
          provide: WORKFLOW_ENGINE,
          useValue: options.engine ?? new JavascriptStateMachineEngine(),
        },
        {
          provide: WORKFLOW_MODULE_OPTIONS,
          useValue: {
            maxTransitionDepth: options.maxTransitionDepth ?? DEFAULT_MAX_DEPTH,
            timeoutEventType: options.timeoutEventType ?? DEFAULT_TIMEOUT_EVENT,
            cronExpression: options.cronExpression ?? DEFAULT_CRON_EXPRESSION,
            enableTimeoutCron: options.enableTimeoutCron ?? true,
          },
        },
        WorkflowRegistry,
        WorkflowManager,
        TimeoutCronService,
      ],
      exports: [
        WorkflowManager,
        WorkflowRegistry,
        WORKFLOW_DB_ADAPTER,
        WORKFLOW_ENGINE,
      ],
      global: true,
    };
  }

  static forRootAsync(options: WorkflowModuleAsyncOptions): DynamicModule {
    return {
      module: WorkflowModule,
      imports: [
        DiscoveryModule,
        ScheduleModule.forRoot(),
        EventEmitterModule.forRoot(),
        ...(options.imports ?? []),
      ],
      providers: [
        {
          provide: WORKFLOW_MODULE_OPTIONS,
          useFactory: async (...args: any[]) => {
            const opts = await options.useFactory(...args);
            return {
              maxTransitionDepth: opts.maxTransitionDepth ?? DEFAULT_MAX_DEPTH,
              timeoutEventType: opts.timeoutEventType ?? DEFAULT_TIMEOUT_EVENT,
              cronExpression: opts.cronExpression ?? DEFAULT_CRON_EXPRESSION,
              enableTimeoutCron: opts.enableTimeoutCron ?? true,
            };
          },
          inject: options.inject ?? [],
        },
        {
          provide: WORKFLOW_DB_ADAPTER,
          useFactory: async (...args: any[]) => {
            const opts = await options.useFactory(...args);
            return opts.adapter;
          },
          inject: options.inject ?? [],
        },
        {
          provide: WORKFLOW_ENGINE,
          useFactory: async (...args: any[]) => {
            const opts = await options.useFactory(...args);
            return opts.engine ?? new JavascriptStateMachineEngine();
          },
          inject: options.inject ?? [],
        },
        WorkflowRegistry,
        WorkflowManager,
        TimeoutCronService,
      ],
      exports: [
        WorkflowManager,
        WorkflowRegistry,
        WORKFLOW_DB_ADAPTER,
        WORKFLOW_ENGINE,
      ],
      global: true,
    };
  }
}
