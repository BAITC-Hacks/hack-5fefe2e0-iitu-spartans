import { describe, expect, it } from "vitest";
import { toTurnRow } from "./journal";

// Строка журнала строится из ответа хода: выбранный сценарий и уверенность — отдельные столбцы для статистики.
const TRACE = {
  turn: 2,
  transcript: "Когда будет выплата?",
  language: "ru" as const,
  source: "demo" as const,
  decision: {
    scenarios: [{ scenario_id: "SC17", confidence: 0.8, reason: "r" }],
    alternatives: [],
    language: "ru" as const,
    slots: {},
    is_continuation: false,
  },
  action: { kind: "run" as const, queue: ["SC17"] },
  scenarioNames: { SC17: "«статус страхового случая»" },
  latencyMs: { router: 5, response: 1, total: 9 },
};

describe("toTurnRow — строка журнала ходов", () => {
  it("выносит выбранный сценарий и уверенность в отдельные поля", () => {
    const row = toTurnRow("11111111-1111-4111-8111-111111111111", TRACE, "Қазір тексерейін.");
    expect(row).toMatchObject({
      turn_no: 2,
      transcript: "Когда будет выплата?",
      action_kind: "run",
      top_scenario: "SC17",
      top_confidence: 0.8,
      reply: "Қазір тексерейін.",
      error: null,
    });
    expect(JSON.parse(row.latency_ms)).toEqual({ router: 5, response: 1, total: 9 });
  });

  it("при сбое маршрутизатора сохраняет ошибку и пустое решение", () => {
    const row = toTurnRow("11111111-1111-4111-8111-111111111111", { ...TRACE, decision: null, error: "completion_failed" }, "x");
    expect(row).toMatchObject({ top_scenario: null, top_confidence: null, decision: null, error: "completion_failed" });
  });
});
