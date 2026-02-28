import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { DuplicateRegistrationError } from '../errors/duplicate-registration.error';
import { WorkflowNotRegisteredError } from '../errors/workflow-not-registered.error';
import { WORKFLOW_ENTITY_METADATA } from '../workflow.constants';
import type { WorkflowEntityMetadata } from '../decorators/workflow-entity.decorator';
import type { DurableWorkflowDefinition } from '../interfaces/durable-workflow-definition.interface';
import { validateWorkflowDefinition } from '../utils/validate-workflow-definition';

export interface RegisteredWorkflow {
  tableName: string;
  definition: DurableWorkflowDefinition;
  targetClass: Function;
}

@Injectable()
export class WorkflowRegistry implements OnModuleInit {
  private readonly logger = new Logger(WorkflowRegistry.name);
  private readonly registrations = new Map<string, RegisteredWorkflow>();

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const providers = this.discoveryService.getProviders();
    for (const wrapper of providers) {
      if (!wrapper.metatype) continue;

      const metadata = this.reflector.get<WorkflowEntityMetadata | undefined>(
        WORKFLOW_ENTITY_METADATA,
        wrapper.metatype,
      );

      if (metadata) {
        this.register(metadata.tableName, metadata.definition, wrapper.metatype);
        this.logger.log(
          `Registered workflow entity: ${wrapper.metatype.name} -> ${metadata.tableName}`,
        );
      }
    }
  }

  register(
    tableName: string,
    definition: DurableWorkflowDefinition,
    targetClass: Function,
  ): void {
    const existing = this.registrations.get(tableName);
    if (existing) {
      throw new DuplicateRegistrationError(
        tableName,
        existing.targetClass.name,
        targetClass.name,
      );
    }
    validateWorkflowDefinition(definition);
    this.registrations.set(tableName, { tableName, definition, targetClass });
  }

  get(tableName: string): RegisteredWorkflow | undefined {
    return this.registrations.get(tableName);
  }

  getAll(): RegisteredWorkflow[] {
    return Array.from(this.registrations.values());
  }

  getOrThrow(tableName: string): RegisteredWorkflow {
    const registration = this.registrations.get(tableName);
    if (!registration) {
      throw new WorkflowNotRegisteredError(tableName);
    }
    return registration;
  }
}
