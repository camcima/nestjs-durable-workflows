export class RecursiveTransitionError extends Error {
  constructor(
    public readonly workflowId: string,
    public readonly depth: number,
    public readonly maxDepth: number,
  ) {
    super(
      `Recursive transition limit (${maxDepth}) exceeded for workflow ${workflowId}. ` +
        `Reached depth ${depth}. Check for infinite always-transition loops.`,
    );
    this.name = 'RecursiveTransitionError';
  }
}
