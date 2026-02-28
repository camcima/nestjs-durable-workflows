import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { IWorkflowDbAdapter } from '../interfaces/workflow-db-adapter.interface';
import {
  WorkflowRecord,
  HistoryRecord,
} from '../interfaces/workflow-records.interface';

const TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Extracts row array from a Drizzle execute() result.
 * Different PG drivers return different shapes:
 * - postgres-js: returns the array directly
 * - node-postgres: returns { rows: [...] }
 */
function extractRows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: any[] }).rows;
  }
  return [];
}

export class DrizzleWorkflowAdapter implements IWorkflowDbAdapter {
  constructor(
    private readonly db: PgDatabase<any, any, any>,
    private readonly defaultTableName: string,
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
    const lockClause = lock ? sql` FOR UPDATE` : sql``;
    const result = await this.db.execute(
      sql`SELECT id, state_value, snapshot, expires_at, updated_at FROM ${sql.raw(tableName)} WHERE id = ${id}${lockClause}`,
    );

    const rows = extractRows(result);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      stateValue: row.state_value,
      snapshot:
        typeof row.snapshot === 'string'
          ? JSON.parse(row.snapshot)
          : row.snapshot,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      updatedAt: new Date(row.updated_at),
    };
  }

  async upsertLive(
    tableName: string,
    id: string,
    data: Omit<WorkflowRecord, 'id' | 'updatedAt'>,
  ): Promise<void> {
    this.validateTableName(tableName);
    const snapshotJson = JSON.stringify(data.snapshot);

    await this.db.execute(
      sql`INSERT INTO ${sql.raw(tableName)} (id, state_value, snapshot, expires_at, updated_at)
          VALUES (${id}, ${data.stateValue}, ${snapshotJson}::jsonb, ${data.expiresAt}, CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO UPDATE SET
            state_value = ${data.stateValue},
            snapshot = ${snapshotJson}::jsonb,
            expires_at = ${data.expiresAt},
            updated_at = CURRENT_TIMESTAMP`,
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

    await this.db.execute(
      sql`INSERT INTO ${sql.raw(historyTable)} (workflow_id, from_state, to_state, event_type, event_payload)
          VALUES (${data.workflowId}, ${data.fromState}, ${data.toState}, ${data.eventType}, ${payloadJson}::jsonb)`,
    );
  }

  async findExpired(tableName: string): Promise<{ id: string }[]> {
    this.validateTableName(tableName);
    const result = await this.db.execute(
      sql`SELECT id FROM ${sql.raw(tableName)} WHERE expires_at < CURRENT_TIMESTAMP`,
    );

    return extractRows(result).map((row: any) => ({ id: row.id }));
  }

  async findByState(
    tableName: string,
    stateValue: string,
  ): Promise<WorkflowRecord[]> {
    this.validateTableName(tableName);
    const result = await this.db.execute(
      sql`SELECT id, state_value, snapshot, expires_at, updated_at FROM ${sql.raw(tableName)} WHERE state_value = ${stateValue}`,
    );

    return extractRows(result).map((row: any) => ({
      id: row.id,
      stateValue: row.state_value,
      snapshot:
        typeof row.snapshot === 'string'
          ? JSON.parse(row.snapshot)
          : row.snapshot,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      updatedAt: new Date(row.updated_at),
    }));
  }

  async transaction<T>(
    cb: (adapter: IWorkflowDbAdapter) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx: any) => {
      const txAdapter = new DrizzleWorkflowAdapter(
        tx as PgDatabase<any, any, any>,
        this.defaultTableName,
      );
      return cb(txAdapter);
    });
  }

  private validateTableName(tableName: string): void {
    if (!TABLE_NAME_REGEX.test(tableName)) {
      throw new Error(
        `Invalid table name "${tableName}". Only alphanumeric characters and underscores are allowed.`,
      );
    }
  }
}
