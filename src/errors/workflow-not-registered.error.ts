export class WorkflowNotRegisteredError extends Error {
  constructor(public readonly tableName: string) {
    super(`No workflow entity registered for table "${tableName}".`);
    this.name = 'WorkflowNotRegisteredError';
  }
}
