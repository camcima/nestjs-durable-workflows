export interface TestPostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getTestPostgresConfig(): TestPostgresConfig {
  return {
    host: process.env.TEST_DB_HOST ?? 'localhost',
    port: parsePort(process.env.TEST_DB_PORT, 5499),
    database: process.env.TEST_DB_NAME ?? 'nestjs_workflow_test',
    user: process.env.TEST_DB_USER ?? 'test',
    password: process.env.TEST_DB_PASSWORD ?? 'test',
  };
}
