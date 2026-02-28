import { WorkflowRecord, HistoryRecord } from './workflow-records.interface';

export interface IWorkflowDbAdapter {
  /**
   * Find a workflow instance by ID.
   * @param tableName - The live table name
   * @param id - Workflow instance UUID
   * @param lock - If true, use SELECT ... FOR UPDATE
   */
  findOne(
    tableName: string,
    id: string,
    lock?: boolean,
  ): Promise<WorkflowRecord | null>;

  /**
   * Insert or update the live table row.
   * Uses ON CONFLICT (id) DO UPDATE.
   */
  upsertLive(
    tableName: string,
    id: string,
    data: Omit<WorkflowRecord, 'id' | 'updatedAt'>,
  ): Promise<void>;

  /**
   * Insert a transition history record.
   */
  insertHistory(
    tableName: string,
    data: Omit<HistoryRecord, 'id' | 'transitionedAt'>,
  ): Promise<void>;

  /**
   * Find all workflow instances with expires_at in the past.
   */
  findExpired(tableName: string): Promise<{ id: string }[]>;

  /**
   * Find all workflow instances in a given state.
   * Enables consumer-driven cleanup/archival of completed workflows.
   */
  findByState(tableName: string, stateValue: string): Promise<WorkflowRecord[]>;

  /**
   * Execute a callback within a database transaction.
   * The callback receives an adapter instance bound to the transaction.
   */
  transaction<T>(cb: (adapter: IWorkflowDbAdapter) => Promise<T>): Promise<T>;
}
