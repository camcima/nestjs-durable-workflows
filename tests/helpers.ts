import { DiscoveryService, Reflector } from '@nestjs/core';
import { WorkflowRegistry } from '../src/services/workflow-registry.service';
import { IWorkflowDbAdapter } from '../src/interfaces/workflow-db-adapter.interface';

export function createMockRegistry(): WorkflowRegistry {
  const mockDiscovery = {
    getProviders: () => [],
  } as unknown as DiscoveryService;
  const mockReflector = { get: () => undefined } as unknown as Reflector;
  return new WorkflowRegistry(mockDiscovery, mockReflector);
}

export function createMockAdapter(): jest.Mocked<IWorkflowDbAdapter> {
  const mockAdapter: jest.Mocked<IWorkflowDbAdapter> = {
    findOne: jest.fn().mockResolvedValue(null),
    upsertLive: jest.fn().mockResolvedValue(undefined),
    insertHistory: jest.fn().mockResolvedValue(undefined),
    findExpired: jest.fn().mockResolvedValue([]),
    findByState: jest.fn().mockResolvedValue([]),
    transaction: jest.fn().mockImplementation(async (cb) => cb(mockAdapter)),
  };
  return mockAdapter;
}
