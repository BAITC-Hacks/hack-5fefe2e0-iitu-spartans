import { pool } from "../../../lib/server/db";

// Проверка готовности: отвечает, жив ли сервис и доступна ли база данных.
// Используется при запуске через Docker Compose и в разделе «Порядок проверки» README.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!pool) {
    return Response.json({ ok: false, db: false, error: "DATABASE_URL не задан" }, { status: 503 });
  }
  try {
    const { rows } = await pool.query<{ migrations: string }>(
      "SELECT count(*)::text AS migrations FROM schema_migrations",
    );
    return Response.json({ ok: true, db: true, migrations: Number(rows[0]?.migrations ?? 0) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, db: false, error: message }, { status: 503 });
  }
}
