export class DuplicateRegistrationError extends Error {
  constructor(
    public readonly tableName: string,
    public readonly class1: string,
    public readonly class2: string,
  ) {
    super(
      `Duplicate workflow table name "${tableName}". ` +
        `Both ${class1} and ${class2} are registered with the same table name.`,
    );
    this.name = 'DuplicateRegistrationError';
  }
}
