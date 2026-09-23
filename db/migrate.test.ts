import { describe, expect, it } from "vitest";
import { pendingMigrations } from "./migrate";

// Миграции — файлы `NNN_описание.sql` в db/migrations. Применяются по возрастанию номера, каждая один раз;
// уже применённые хранятся в таблице schema_migrations. Слитая миграция не редактируется (AGENTS.md).

describe("pendingMigrations — какие миграции применить и в каком порядке", () => {
  it("возвращает ещё не применённые миграции по возрастанию номера", () => {
    const files = ["002_dialogs.sql", "001_scenarios.sql", "003_turns.sql"];
    expect(pendingMigrations(files, new Set(["001_scenarios.sql"]))).toEqual(["002_dialogs.sql", "003_turns.sql"]);
  });

  it("на чистой базе возвращает все миграции", () => {
    expect(pendingMigrations(["001_a.sql", "002_b.sql"], new Set())).toEqual(["001_a.sql", "002_b.sql"]);
  });

  it("пропускает файлы, которые не являются миграциями", () => {
    expect(pendingMigrations(["README.md", "001_a.sql", ".gitkeep"], new Set())).toEqual(["001_a.sql"]);
  });

  it("отклоняет .sql с именем не по формату NNN_описание.sql", () => {
    expect(() => pendingMigrations(["1_a.sql"], new Set())).toThrow(/имя миграции/);
    expect(() => pendingMigrations(["001-A.sql"], new Set())).toThrow(/имя миграции/);
  });

  it("отклоняет две миграции с одним номером", () => {
    expect(() => pendingMigrations(["001_a.sql", "001_b.sql"], new Set())).toThrow(/номер 001/);
  });

  it("когда всё применено, возвращает пустой список", () => {
    expect(pendingMigrations(["001_a.sql"], new Set(["001_a.sql"]))).toEqual([]);
  });
});
