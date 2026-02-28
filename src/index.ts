// Module
export { WorkflowModule } from './workflow.module';

// Services
export { WorkflowManager } from './services/workflow-manager.service';
export { WorkflowRegistry } from './services/workflow-registry.service';
export { TimeoutCronService } from './services/timeout-cron.service';
export type {
  TimeoutCronOptions,
  TimeoutProcessingFailure,
  TimeoutProcessingResult,
} from './services/timeout-cron.service';

// Decorators
export { WorkflowEntity } from './decorators/workflow-entity.decorator';
export { JavascriptStateMachineEngine } from './engines/javascript-state-machine.engine';

// Interfaces
export { IWorkflowDbAdapter } from './interfaces/workflow-db-adapter.interface';
export type {
  DurableWorkflowDefinition,
  DurableStateDefinition,
  DurableSnapshotV1,
  TransitionConfig,
  TransitionRule,
  WorkflowAction,
  WorkflowGuard,
} from './interfaces/durable-workflow-definition.interface';
export type {
  IWorkflowEngine,
  IWorkflowRuntime,
  RuntimeSendResult,
  RuntimeTransition,
} from './interfaces/workflow-engine.interface';
export {
  WorkflowRecord,
  HistoryRecord,
  WorkflowResult,
} from './interfaces/workflow-records.interface';
export {
  WorkflowModuleOptions,
  WorkflowModuleAsyncOptions,
} from './interfaces/workflow-module-options.interface';

// Adapters
export { DrizzleWorkflowAdapter } from './adapters/drizzle-workflow.adapter';
export { InMemoryWorkflowAdapter } from './adapters/in-memory-workflow.adapter';
export { PgWorkflowAdapter } from './adapters/pg-workflow.adapter';
export {
  PrismaWorkflowAdapter,
  PrismaRawExecutor,
  PrismaTransactionRunner,
} from './adapters/prisma-workflow.adapter';

// Errors
export { RecursiveTransitionError } from './errors/recursive-transition.error';
export { InvalidSnapshotError } from './errors/invalid-snapshot.error';
export { WorkflowNotRegisteredError } from './errors/workflow-not-registered.error';
export { DuplicateRegistrationError } from './errors/duplicate-registration.error';

// Events
export { WorkflowEventType } from './events/workflow-event-type.enum';
export {
  WorkflowTransitionEvent,
  WorkflowCreatedEvent,
  WorkflowTimeoutTriggeredEvent,
} from './events/workflow-events';

// CLI
export { generateMigration } from './cli/generate-migration';

// Constants
export {
  WORKFLOW_MODULE_OPTIONS,
  WORKFLOW_DB_ADAPTER,
  WORKFLOW_ENGINE,
  DEFAULT_CRON_EXPRESSION,
  DEFAULT_TIMEOUT_EVENT,
  DEFAULT_MAX_DEPTH,
  WORKFLOW_ENTITY_METADATA,
} from './workflow.constants';
