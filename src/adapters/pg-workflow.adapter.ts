import type { Pool, PoolClient } from 'pg';
import { IWorkflowDbAdapter } from '../interfaces/workflow-db-adapter.interface';
import {
  HistoryRecord,
  WorkflowRecord,
} from '../interfaces/workflow-records.interface';

const TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

interface PgLiveWorkflowRow {
  id: string;
  state_value: string;
  snapshot: unknown;
  expires_at: Date | string | null;
  updated_at: Date | string;
}

interface PgIdRow {
  id: string;
}

type PgQueryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export class PgWorkflowAdapter implements IWorkflowDbAdapter {
  constructor(
    private readonly pool: Pool,
    private readonly defaultTableName: string,
    private readonly client?: PoolClient,
  ) {
    if (!TABLE_NAME_REGEX.test(defaultTableName)) {
      throw new Error(
        `Invalid table name "${defaultTableName}". Only alphanumeric characters and underscores are allowed.`,
      );
    }
  }

  async findOne(
    tableName: string,
    id: string,
    lock?: boolean,
  ): Promise<WorkflowRecord | null> {
    this.validateTableName(tableName);
    const conn = this.getConn();
    const lockClause = lock ? ' FOR UPDATE' : '';

    const result = await conn.query<PgLiveWorkflowRow>(
      `SELECT id, state_value, snapshot, expires_at, updated_at
       FROM ${tableName}
       WHERE id = $1::uuid${lockClause}`,
      [id],
    );

    if (result.rows.length === 0) return null;
    return this.toWorkflowRecord(result.rows[0]);
  }

  async upsertLive(
    tableName: string,
    id: string,
    data: Omit<WorkflowRecord, 'id' | 'updatedAt'>,
  ): Promise<void> {
    this.validateTableName(tableName);
    const conn = this.getConn();
    const snapshotJson = JSON.stringify(data.snapshot);

    await conn.query(
      `INSERT INTO ${tableName} (id, state_value, snapshot, expires_at, updated_at)
       VALUES ($1::uuid, $2, $3::jsonb, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         state_value = $2,
         snapshot = $3::jsonb,
         expires_at = $4,
         updated_at = CURRENT_TIMESTAMP`,
      [id, data.stateValue, snapshotJson, data.expiresAt],
    );
  }

  async insertHistory(
    tableName: string,
    data: Omit<HistoryRecord, 'id' | 'transitionedAt'>,
  ): Promise<void> {
    this.validateTableName(tableName);
    const historyTable = `${tableName}_history`;
    this.validateTableName(historyTable);
    const conn = this.getConn();
    const payloadJson = JSON.stringify(data.eventPayload);

    await conn.query(
      `INSERT INTO ${historyTable}
       (workflow_id, from_state, to_state, event_type, event_payload)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
      [
        data.workflowId,
        data.fromState,
        data.toState,
        data.eventType,
        payloadJson,
      ],
    );
  }

  async findExpired(tableName: string): Promise<{ id: string }[]> {
    this.validateTableName(tableName);
    const conn = this.getConn();
    const result = await conn.query<PgIdRow>(
      `SELECT id FROM ${tableName} WHERE expires_at < CURRENT_TIMESTAMP`,
    );

    return result.rows.map((row) => ({ id: row.id }));
  }

  async findByState(
    tableName: string,
    stateValue: string,
  ): Promise<WorkflowRecord[]> {
    this.validateTableName(tableName);
    const conn = this.getConn();
    const result = await conn.query<PgLiveWorkflowRow>(
      `SELECT id, state_value, snapshot, expires_at, updated_at
       FROM ${tableName}
       WHERE state_value = $1`,
      [stateValue],
    );

    return result.rows.map((row) => this.toWorkflowRecord(row));
  }

  async transaction<T>(
    cb: (adapter: IWorkflowDbAdapter) => Promise<T>,
  ): Promise<T> {
    if (this.client) {
      return cb(this);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter = new PgWorkflowAdapter(
        this.pool,
        this.defaultTableName,
        client,
      );
      const result = await cb(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private getConn(): PgQueryable {
    return this.client ?? this.pool;
  }

  private toWorkflowRecord(row: PgLiveWorkflowRow): WorkflowRecord {
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
