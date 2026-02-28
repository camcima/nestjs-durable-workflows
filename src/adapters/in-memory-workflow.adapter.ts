import { randomUUID } from 'crypto';
import { IWorkflowDbAdapter } from '../interfaces/workflow-db-adapter.interface';
import {
  HistoryRecord,
  WorkflowRecord,
} from '../interfaces/workflow-records.interface';

const TABLE_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

interface InMemoryState {
  liveByTable: Map<string, Map<string, WorkflowRecord>>;
  historyByTable: Map<string, HistoryRecord[]>;
}

function cloneJson(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function cloneWorkflowRecord(record: WorkflowRecord): WorkflowRecord {
  return {
    id: record.id,
    stateValue: record.stateValue,
    snapshot: cloneJson(record.snapshot),
    expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
    updatedAt: new Date(record.updatedAt),
  };
}

function cloneHistoryRecord(record: HistoryRecord): HistoryRecord {
  return {
    id: record.id,
    workflowId: record.workflowId,
    fromState: record.fromState,
    toState: record.toState,
    eventType: record.eventType,
    eventPayload: cloneJson(record.eventPayload),
    transitionedAt: new Date(record.transitionedAt),
  };
}

function createEmptyState(): InMemoryState {
  return {
    liveByTable: new Map<string, Map<string, WorkflowRecord>>(),
    historyByTable: new Map<string, HistoryRecord[]>(),
  };
}

function cloneState(state: InMemoryState): InMemoryState {
  const liveByTable = new Map<string, Map<string, WorkflowRecord>>();
  for (const [tableName, rows] of state.liveByTable.entries()) {
    const clonedRows = new Map<string, WorkflowRecord>();
    for (const [id, row] of rows.entries()) {
      clonedRows.set(id, cloneWorkflowRecord(row));
    }
    liveByTable.set(tableName, clonedRows);
  }

  const historyByTable = new Map<string, HistoryRecord[]>();
  for (const [tableName, rows] of state.historyByTable.entries()) {
    historyByTable.set(
      tableName,
      rows.map((row) => cloneHistoryRecord(row)),
    );
  }

  return { liveByTable, historyByTable };
}

export class InMemoryWorkflowAdapter implements IWorkflowDbAdapter {
  private state: InMemoryState;

  constructor(
    private readonly defaultTableName: string,
    state?: InMemoryState,
    private readonly transactionBound = false,
  ) {
    this.validateTableName(defaultTableName);
    this.state = state ?? createEmptyState();
  }

  async findOne(
    tableName: string,
    id: string,
    _lock?: boolean,
  ): Promise<WorkflowRecord | null> {
    this.validateTableName(tableName);
    const row = this.getLiveTable(tableName).get(id);
    return row ? cloneWorkflowRecord(row) : null;
  }

  async upsertLive(
    tableName: string,
    id: string,
    data: Omit<WorkflowRecord, 'id' | 'updatedAt'>,
  ): Promise<void> {
    this.validateTableName(tableName);
    this.getLiveTable(tableName).set(id, {
      id,
      stateValue: data.stateValue,
      snapshot: cloneJson(data.snapshot),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      updatedAt: new Date(),
    });
  }

  async insertHistory(
    tableName: string,
    data: Omit<HistoryRecord, 'id' | 'transitionedAt'>,
  ): Promise<void> {
    this.validateTableName(tableName);
    const historyTable = `${tableName}_history`;
    this.validateTableName(historyTable);

    this.getHistoryTable(tableName).push({
      id: randomUUID(),
      workflowId: data.workflowId,
      fromState: data.fromState,
      toState: data.toState,
      eventType: data.eventType,
      eventPayload: cloneJson(data.eventPayload),
      transitionedAt: new Date(),
    });
  }

  async findExpired(tableName: string): Promise<{ id: string }[]> {
    this.validateTableName(tableName);
    const now = Date.now();
    const rows = this.getLiveTable(tableName).values();

    const expired: { id: string }[] = [];
    for (const row of rows) {
      if (row.expiresAt && row.expiresAt.getTime() < now) {
        expired.push({ id: row.id });
      }
    }

    return expired;
  }

  async findByState(
    tableName: string,
    stateValue: string,
  ): Promise<WorkflowRecord[]> {
    this.validateTableName(tableName);

    const matches: WorkflowRecord[] = [];
    for (const row of this.getLiveTable(tableName).values()) {
      if (row.stateValue === stateValue) {
        matches.push(cloneWorkflowRecord(row));
      }
    }

    return matches;
  }

  async transaction<T>(
    cb: (adapter: IWorkflowDbAdapter) => Promise<T>,
  ): Promise<T> {
    if (this.transactionBound) {
      return cb(this);
    }

    const txState = cloneState(this.state);
    const txAdapter = new InMemoryWorkflowAdapter(
      this.defaultTableName,
      txState,
      true,
    );

    const result = await cb(txAdapter);
    this.state = txState;
    return result;
  }

  private getLiveTable(tableName: string): Map<string, WorkflowRecord> {
    const table = this.state.liveByTable.get(tableName);
    if (table) return table;

    const next = new Map<string, WorkflowRecord>();
    this.state.liveByTable.set(tableName, next);
    return next;
  }

  private getHistoryTable(tableName: string): HistoryRecord[] {
    const table = this.state.historyByTable.get(tableName);
    if (table) return table;

    const next: HistoryRecord[] = [];
    this.state.historyByTable.set(tableName, next);
    return next;
  }

  private validateTableName(tableName: string): void {
    if (!TABLE_NAME_REGEX.test(tableName)) {
      throw new Error(
        `Invalid table name "${tableName}". Only alphanumeric characters and underscores are allowed.`,
      );
    }
  }
}
