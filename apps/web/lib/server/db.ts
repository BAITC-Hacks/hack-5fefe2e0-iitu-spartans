import pg from "pg";

/**
 * Общий пул соединений с PostgreSQL для маршрутов API. Без DATABASE_URL пул не создаётся:
 * приложение продолжает работать, а журнал ходов просто не пишется.
 */
export const pool: pg.Pool | null = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  : null;
