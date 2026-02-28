import { IWorkflowDbAdapter } from '../interfaces/workflow-db-adapter.interface';
import {
  HistoryRecord,
  WorkflowRecord,
} from '../interfaces/workflow-records.interface';

const TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface PrismaRawExecutor {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

export interface PrismaTransactionRunner<TTx = PrismaRawExecutor> {
  $transaction<T>(cb: (tx: TTx) => Promise<T>): Promise<T>;
}

interface LiveWorkflowRow {
  id: string;
  state_value: string;
  snapshot: unknown;
  expires_at: Date | string | null;
  updated_at: Date | string;
}

interface ExpiredRow {
  id: string;
}

function hasTransactionRunner(
  executor: PrismaRawExecutor,
): executor is PrismaRawExecutor & PrismaTransactionRunner {
  return (
    '$transaction' in executor && typeof executor.$transaction === 'function'
  );
}

export class PrismaWorkflowAdapter implements IWorkflowDbAdapter {
  private readonly txRunner?: PrismaTransactionRunner;

  constructor(
    private readonly executor: PrismaRawExecutor,
    private readonly defaultTableName: string,
    txRunner?: PrismaTransactionRunner,
  ) {
    if (!TABLE_NAME_REGEX.test(defaultTableName)) {
      throw new Error(
        `Invalid table name "${defaultTableName}". Only alphanumeric characters and underscores are allowed.`,
      );
    }

    this.txRunner =
      txRunner ?? (hasTransactionRunner(executor) ? executor : undefined);
  }

  async findOne(
    tableName: string,
    id: string,
    lock?: boolean,
  ): Promise<WorkflowRecord | null> {
    this.validateTableName(tableName);

    const query = `SELECT id, state_value, snapshot, expires_at, updated_at FROM ${tableName} WHERE id = $1::uuid${lock ? ' FOR UPDATE' : ''}`;
    const rows = await this.executor.$queryRawUnsafe<LiveWorkflowRow[]>(
      query,
      id,
    );
    if (rows.length === 0) return null;

    return this.toWorkflowRecord(rows[0]);
  }

  async upsertLive(
    tableName: string,
    id: string,
    data: Omit<WorkflowRecord, 'id' | 'updatedAt'>,
  ): Promise<void> {
    this.validateTableName(tableName);
    const snapshotJson = JSON.stringify(data.snapshot);

    await this.executor.$executeRawUnsafe(
      `INSERT INTO ${tableName} (id, state_value, snapshot, expires_at, updated_at)
       VALUES ($1::uuid, $2, $3::jsonb, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         state_value = $2,
         snapshot = $3::jsonb,
         expires_at = $4,
         updated_at = CURRENT_TIMESTAMP`,
      id,
      data.stateValue,
      snapshotJson,
      data.expiresAt,
    );
  }

  async insertHistory(
    tableName: string,
    data: Omit<HistoryRecord, 'id' | 'transitionedAt'>,
  ): Promise<void> {
    this.validateTableName(tableName);
    const historyTable = `${tableName}_history`;
    this.validateTableName(historyTable);
    const payloadJson = JSON.stringify(data.eventPayload);

    await this.executor.$executeRawUnsafe(
      `INSERT INTO ${historyTable} (workflow_id, from_state, to_state, event_type, event_payload)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
      data.workflowId,
      data.fromState,
      data.toState,
      data.eventType,
      payloadJson,
    );
  }

  async findExpired(tableName: string): Promise<{ id: string }[]> {
    this.validateTableName(tableName);
    const rows = await this.executor.$queryRawUnsafe<ExpiredRow[]>(
      `SELECT id FROM ${tableName} WHERE expires_at < CURRENT_TIMESTAMP`,
    );

    return rows.map((row) => ({ id: row.id }));
  }

  async findByState(
    tableName: string,
    stateValue: string,
  ): Promise<WorkflowRecord[]> {
    this.validateTableName(tableName);
    const rows = await this.executor.$queryRawUnsafe<LiveWorkflowRow[]>(
      `SELECT id, state_value, snapshot, expires_at, updated_at FROM ${tableName} WHERE state_value = $1`,
      stateValue,
    );

    return rows.map((row) => this.toWorkflowRecord(row));
  }

  async transaction<T>(
    cb: (adapter: IWorkflowDbAdapter) => Promise<T>,
  ): Promise<T> {
    if (!this.txRunner) {
      return cb(this);
    }

    return this.txRunner.$transaction(async (tx: PrismaRawExecutor) => {
      const txAdapter = new PrismaWorkflowAdapter(tx, this.defaultTableName);
      return cb(txAdapter);
    });
  }

  private toWorkflowRecord(row: LiveWorkflowRow): WorkflowRecord {
    return {
      id: row.id,
      stateValue: row.state_value,
      snapshot:
        typeof row.snapshot === 'string'
          ? (JSON.parse(row.snapshot) as Record<string, unknown>)
          : (row.snapshot as Record<string, unknown>),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      updatedAt: new Date(row.updated_at),
    };
  }

  private validateTableName(tableName: string): void {
    if (!TABLE_NAME_REGEX.test(tableName)) {
      throw new Error(
        `Invalid table name "${tableName}". Only alphanumeric characters and underscores are allowed.`,
      );
    }
  }
}
