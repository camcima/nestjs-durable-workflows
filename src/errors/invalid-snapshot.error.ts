export class InvalidSnapshotError extends Error {
  constructor(
    public readonly workflowId: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidSnapshotError';
  }
}
