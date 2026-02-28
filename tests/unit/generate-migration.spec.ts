import { generateMigration } from '../../src/cli/generate-migration';

describe('generateMigration', () => {
  const sql = generateMigration('orders');

  describe('live table', () => {
    it('should create the live table with correct columns', () => {
      expect(sql).toContain('CREATE TABLE orders');
      expect(sql).toContain('id UUID PRIMARY KEY DEFAULT uuidv7()');
      expect(sql).toContain('state_value TEXT NOT NULL');
      expect(sql).toContain('snapshot JSONB NOT NULL');
      expect(sql).toContain('expires_at TIMESTAMPTZ');
      expect(sql).toContain(
        'updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
      );
    });

    it('should create a partial index on expires_at', () => {
      expect(sql).toContain('CREATE INDEX idx_orders_expires_at');
      expect(sql).toContain('ON orders (expires_at)');
      expect(sql).toContain('WHERE expires_at IS NOT NULL');
    });

    it('should create a btree index on state_value', () => {
      expect(sql).toContain('CREATE INDEX idx_orders_state_value');
      expect(sql).toContain('ON orders (state_value)');
    });

    it('should create a GIN index on snapshot', () => {
      expect(sql).toContain('CREATE INDEX idx_orders_snapshot_gin');
      expect(sql).toContain('ON orders USING gin (snapshot)');
    });
  });

  describe('history table', () => {
    it('should create the history table with FK to live table', () => {
      expect(sql).toContain('CREATE TABLE orders_history');
      expect(sql).toContain('workflow_id UUID NOT NULL REFERENCES orders(id)');
      expect(sql).toContain('from_state TEXT NOT NULL');
      expect(sql).toContain('to_state TEXT NOT NULL');
      expect(sql).toContain('event_type TEXT NOT NULL');
      expect(sql).toContain('event_payload JSONB NOT NULL');
      expect(sql).toContain(
        'transitioned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
      );
    });

    it('should create a btree index on workflow_id', () => {
      expect(sql).toContain('CREATE INDEX idx_orders_history_workflow_id');
      expect(sql).toContain('ON orders_history (workflow_id)');
    });

    it('should create a btree index on transitioned_at', () => {
      expect(sql).toContain('CREATE INDEX idx_orders_history_transitioned_at');
      expect(sql).toContain('ON orders_history (transitioned_at)');
    });

    it('should create a GIN index on event_payload', () => {
      expect(sql).toContain(
        'CREATE INDEX idx_orders_history_event_payload_gin',
      );
      expect(sql).toContain('ON orders_history USING gin (event_payload)');
    });
  });

  describe('migrate:down', () => {
    it('should drop history table before live table', () => {
      expect(sql).toContain('-- migrate:down');
      expect(sql).toContain('DROP TABLE IF EXISTS orders_history');
      expect(sql).toContain('DROP TABLE IF EXISTS orders');

      const downIdx = sql.indexOf('-- migrate:down');
      const dropHistoryIdx = sql.indexOf('DROP TABLE IF EXISTS orders_history');
      const dropLiveIdx = sql.indexOf('DROP TABLE IF EXISTS orders;');

      // History table must be dropped before live table (FK dependency)
      expect(dropHistoryIdx).toBeGreaterThan(downIdx);
      expect(dropLiveIdx).toBeGreaterThan(dropHistoryIdx);
    });
  });

  describe('table name substitution', () => {
    it('should substitute a different table name throughout', () => {
      const customSql = generateMigration('warehouse_picks');

      expect(customSql).toContain('CREATE TABLE warehouse_picks');
      expect(customSql).toContain('CREATE TABLE warehouse_picks_history');
      expect(customSql).toContain('idx_warehouse_picks_expires_at');
      expect(customSql).toContain('idx_warehouse_picks_state_value');
      expect(customSql).toContain('idx_warehouse_picks_snapshot_gin');
      expect(customSql).toContain('idx_warehouse_picks_history_workflow_id');
      expect(customSql).toContain(
        'idx_warehouse_picks_history_event_payload_gin',
      );
      expect(customSql).toContain('REFERENCES warehouse_picks(id)');
    });
  });

  describe('table name validation', () => {
    it('should reject invalid table names', () => {
      expect(() => generateMigration('orders; DROP TABLE')).toThrow(
        'Invalid table name',
      );
      expect(() => generateMigration("orders' OR 1=1")).toThrow(
        'Invalid table name',
      );
    });

    it('should accept underscored table names', () => {
      expect(() => generateMigration('order_workflows')).not.toThrow();
    });
  });
});
