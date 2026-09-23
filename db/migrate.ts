/**
 * Запуск миграций PostgreSQL: `node db/migrate.ts` (Node 24 исполняет TypeScript без сборки).
 *
 * Миграции — файлы `db/migrations/NNN_описание.sql`. Каждая применяется один раз, в своей транзакции,
 * и записывается в schema_migrations. Слитая миграция не редактируется: исправление — новым номером.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATION_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

/** Ключ advisory-блокировки: два одновременных запуска (например, два контейнера) не применят миграции дважды. */
const MIGRATION_LOCK_KEY = 20260923;

/**
 * Какие миграции применить и в каком порядке. Чистая функция: проверяется без базы данных.
 * Отклоняет имена не по формату и повторный номер — такие ошибки должны остановить запуск, а не пройти тихо.
 */
export function pendingMigrations(files: string[], applied: Set<string>): string[] {
  const migrations = files.filter((file) => file.endsWith(".sql"));
  const byNumber = new Map<string, string>();
  for (const file of migrations) {
    const match = MIGRATION_NAME.exec(file);
    if (!match) throw new Error(`имя миграции не по формату NNN_описание.sql: ${file}`);
    const number = match[1] ?? "";
    const taken = byNumber.get(number);
    if (taken) throw new Error(`номер ${number} занят дважды: ${taken} и ${file}`);
    byNumber.set(number, file);
  }
  return migrations.filter((file) => !applied.has(file)).sort();
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан — см. .env.example");

  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const todo = pendingMigrations(await readdir(dir), new Set(rows.map((row) => row.name)));

    for (const name of todo) {
      const sql = await readFile(path.join(dir, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
        console.log(`миграция применена: ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`миграция ${name} не применена: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(todo.length > 0 ? `миграций применено: ${todo.length}` : "миграции: схема актуальна");
  } finally {
    await client.end();
  }
}

// Запуск только при прямом вызове файла; при импорте из тестов ничего не выполняется.
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
