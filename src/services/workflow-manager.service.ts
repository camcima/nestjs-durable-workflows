import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowRegistry } from './workflow-registry.service';
import { IWorkflowDbAdapter } from '../interfaces/workflow-db-adapter.interface';
import { WorkflowResult } from '../interfaces/workflow-records.interface';
import { WorkflowEventType } from '../events/workflow-event-type.enum';
import type {
  WorkflowTransitionEvent,
  WorkflowCreatedEvent,
} from '../events/workflow-events';
import { getTimeoutExpiry } from '../utils/get-timeout-minutes';
import {
  WORKFLOW_MODULE_OPTIONS,
  WORKFLOW_DB_ADAPTER,
  WORKFLOW_ENGINE,
} from '../workflow.constants';
import type {
  IWorkflowEngine,
  RuntimeTransition,
} from '../interfaces/workflow-engine.interface';
import { JavascriptStateMachineEngine } from '../engines/javascript-state-machine.engine';
import type { WorkflowEventPayload } from '../interfaces/durable-workflow-definition.interface';

export interface WorkflowManagerOptions {
  maxTransitionDepth: number;
  timeoutEventType: string;
}

@Injectable()
export class WorkflowManager {
  private readonly logger = new Logger(WorkflowManager.name);
  private readonly engine: IWorkflowEngine;

  constructor(
    private readonly registry: WorkflowRegistry,
    @Inject(WORKFLOW_DB_ADAPTER) private readonly adapter: IWorkflowDbAdapter,
    private readonly eventEmitter: EventEmitter2,
    @Inject(WORKFLOW_MODULE_OPTIONS)
    private readonly options: WorkflowManagerOptions,
    @Optional() @Inject(WORKFLOW_ENGINE) engine?: IWorkflowEngine,
  ) {
    this.engine = engine ?? new JavascriptStateMachineEngine();
  }

  async send(
    tableName: string,
    id: string,
    event: WorkflowEventPayload,
  ): Promise<WorkflowResult> {
    const registration = this.registry.getOrThrow(tableName);
    const definition = registration.definition;

    return this.adapter.transaction(async (txAdapter) => {
      const existing = await txAdapter.findOne(tableName, id, true);
      const isNew = !existing;

      const runtime = this.engine.createRuntime({
        definition,
        snapshot: existing?.snapshot,
        maxTransitionDepth: this.options.maxTransitionDepth,
        workflowId: id,
      });

      const sendResult = await runtime.send(event);
      const settledStateValue = sendResult.stateValue;
      const settledSnapshot = runtime.dehydrate();
      const isDone = sendResult.done;
      const transitions = sendResult.transitions;
      const expiresAt = getTimeoutExpiry(definition, settledStateValue);

      await txAdapter.upsertLive(tableName, id, {
        stateValue: settledStateValue,
        snapshot: settledSnapshot as unknown as Record<string, unknown>,
        expiresAt,
      });

      await this.persistHistory(txAdapter, tableName, id, transitions, event);

      if (isNew) {
        this.eventEmitter.emit(WorkflowEventType.CREATED, {
          workflowType: tableName,
          instanceId: id,
          initialState: settledStateValue,
          timestamp: new Date(),
        } satisfies WorkflowCreatedEvent);
      }

      for (const transition of transitions) {
        this.eventEmitter.emit(WorkflowEventType.TRANSITION, {
          workflowType: tableName,
          instanceId: id,
          fromState: transition.fromState,
          toState: transition.toState,
          eventType: event.type,
          eventPayload: event as Record<string, unknown>,
          timestamp: new Date(),
        } satisfies WorkflowTransitionEvent);
      }

      this.logger.log(
        `Workflow ${tableName}/${id}: ${transitions.length} transition(s) persisted, state=${settledStateValue}`,
      );

      return {
        id,
        stateValue: settledStateValue,
        snapshot: settledSnapshot as unknown as Record<string, unknown>,
        transitionCount: transitions.length,
        done: isDone,
      };
    });
  }

  private async persistHistory(
    txAdapter: IWorkflowDbAdapter,
    tableName: string,
    workflowId: string,
    transitions: RuntimeTransition[],
    event: WorkflowEventPayload,
  ): Promise<void> {
    if (transitions.length === 0) {
      return;
    }

    await Promise.all(
      transitions.map((transition) =>
        txAdapter.insertHistory(tableName, {
          workflowId,
          fromState: transition.fromState,
          toState: transition.toState,
          eventType: event.type,
          eventPayload: event as Record<string, unknown>,
        }),
      ),
    );
  }
}
