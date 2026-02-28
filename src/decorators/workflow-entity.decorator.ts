import { SetMetadata } from '@nestjs/common';
import { WORKFLOW_ENTITY_METADATA } from '../workflow.constants';
import { deriveTableName } from '../utils/derive-table-name';
import type { DurableWorkflowDefinition } from '../interfaces/durable-workflow-definition.interface';

export interface WorkflowEntityOptions {
  /** Database table name. If omitted, derived from class name. */
  tableName?: string;
  /** Durable workflow definition consumed by runtime engine */
  definition: DurableWorkflowDefinition;
}

export interface WorkflowEntityMetadata {
  tableName: string;
  definition: DurableWorkflowDefinition;
}

export function WorkflowEntity(options: WorkflowEntityOptions): ClassDecorator {
  return (target: Function) => {
    const tableName = options.tableName ?? deriveTableName(target.name);
    const metadata: WorkflowEntityMetadata = {
      tableName,
      definition: options.definition,
    };
    SetMetadata(WORKFLOW_ENTITY_METADATA, metadata)(target);
    Reflect.defineMetadata(WORKFLOW_ENTITY_METADATA, metadata, target);
  };
}
