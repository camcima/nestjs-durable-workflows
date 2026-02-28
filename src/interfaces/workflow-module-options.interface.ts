import { IWorkflowDbAdapter } from './workflow-db-adapter.interface';
import type { IWorkflowEngine } from './workflow-engine.interface';

export interface WorkflowModuleOptions {
  /** Database adapter instance implementing IWorkflowDbAdapter */
  adapter: IWorkflowDbAdapter;
  /** Optional runtime engine override */
  engine?: IWorkflowEngine;

  /** Cron expression for timeout expiration. Default: every 60 seconds */
  cronExpression?: string;

  /** Event type sent to expired workflows. Default: 'TIMEOUT' */
  timeoutEventType?: string;

  /** Enable internal timeout cron registration. Default: true */
  enableTimeoutCron?: boolean;

  /** Max recursive transition depth. Default: 100 */
  maxTransitionDepth?: number;
}

export interface WorkflowModuleAsyncOptions {
  imports?: any[];
  useFactory: (
    ...args: any[]
  ) => Promise<WorkflowModuleOptions> | WorkflowModuleOptions;
  inject?: any[];
}
