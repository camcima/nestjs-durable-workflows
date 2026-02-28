import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CronJob } from 'cron';
import { WorkflowRegistry } from './workflow-registry.service';
import { WorkflowManager } from './workflow-manager.service';
import { IWorkflowDbAdapter } from '../interfaces/workflow-db-adapter.interface';
import { WorkflowEventType } from '../events/workflow-event-type.enum';
import type { WorkflowTimeoutTriggeredEvent } from '../events/workflow-events';
import {
  WORKFLOW_MODULE_OPTIONS,
  WORKFLOW_DB_ADAPTER,
} from '../workflow.constants';

export interface TimeoutCronOptions {
  cronExpression: string;
  timeoutEventType: string;
  enableTimeoutCron: boolean;
}

export interface TimeoutProcessingFailure {
  workflowType: string;
  instanceId: string;
  error: string;
}

export interface TimeoutProcessingResult {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  workflowTypesScanned: number;
  expiredFound: number;
  attempted: number;
  succeeded: number;
  failed: number;
  failures: TimeoutProcessingFailure[];
}

@Injectable()
export class TimeoutCronService implements OnModuleInit {
  private readonly logger = new Logger(TimeoutCronService.name);

  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly manager: WorkflowManager,
    @Inject(WORKFLOW_DB_ADAPTER) private readonly adapter: IWorkflowDbAdapter,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly eventEmitter: EventEmitter2,
    @Inject(WORKFLOW_MODULE_OPTIONS)
    private readonly options: TimeoutCronOptions,
  ) {}

  onModuleInit(): void {
    if (!this.options.enableTimeoutCron) {
      this.logger.log('Timeout cron disabled by configuration');
      return;
    }

    const job = new CronJob(this.options.cronExpression, () => {
      this.processExpiredWorkflows()
        .then((summary) => {
          this.logger.log(
            `Timeout cron summary: scanned=${summary.workflowTypesScanned}, expired=${summary.expiredFound}, attempted=${summary.attempted}, succeeded=${summary.succeeded}, failed=${summary.failed}, durationMs=${summary.durationMs}`,
          );
        })
        .catch((err) => {
          this.logger.error('Unhandled error in timeout cron', err);
        });
    });

    this.schedulerRegistry.addCronJob('workflow-timeout', job);
    job.start();
    this.logger.log(
      `Timeout cron registered with expression: ${this.options.cronExpression}`,
    );
  }

  async processExpiredWorkflows(): Promise<TimeoutProcessingResult> {
    const startedAt = new Date();
    const summary: TimeoutProcessingResult = {
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      workflowTypesScanned: 0,
      expiredFound: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      failures: [],
    };

    const registrations = this.registry.getAll();

    for (const registration of registrations) {
      summary.workflowTypesScanned++;
      const expired = await this.adapter.findExpired(registration.tableName);
      summary.expiredFound += expired.length;

      for (const instance of expired) {
        summary.attempted++;
        try {
          await this.manager.send(registration.tableName, instance.id, {
            type: this.options.timeoutEventType,
          });
          summary.succeeded++;
        } catch (error) {
          summary.failed++;
          summary.failures.push({
            workflowType: registration.tableName,
            instanceId: instance.id,
            error: error instanceof Error ? error.message : String(error),
          });

          // Continue processing remaining instances (FR-009)
          this.logger.error(
            `Failed to process timeout for ${registration.tableName}/${instance.id}`,
            error instanceof Error ? error.stack : error,
          );
          continue;
        }

        try {
          this.eventEmitter.emit(WorkflowEventType.TIMEOUT_TRIGGERED, {
            workflowType: registration.tableName,
            instanceId: instance.id,
            state: '',
            expiredAt: new Date(),
            timestamp: new Date(),
          } satisfies WorkflowTimeoutTriggeredEvent);

          this.logger.log(
            `Timeout processed: ${registration.tableName}/${instance.id}`,
          );
        } catch (error) {
          this.logger.error(
            `Timeout side effects failed for ${registration.tableName}/${instance.id}`,
            error instanceof Error ? error.stack : error,
          );
        }
      }
    }

    summary.finishedAt = new Date();
    summary.durationMs =
      summary.finishedAt.getTime() - summary.startedAt.getTime();

    return summary;
  }
}
