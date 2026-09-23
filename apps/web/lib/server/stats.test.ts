import { describe, expect, it } from "vitest";
import { toSupervisorStats } from "./stats";

// pg отдаёт bigint и numeric строками: сводка обязана привести их к числам, иначе доли считаются как склейка строк.
describe("toSupervisorStats — сводка журнала для супервизора", () => {
  it("приводит строки базы к числам и считает доли действий от всех ходов", () => {
    const stats = toSupervisorStats(
      { turns: "8", dialogs: "3", run: "5", clarify: "2", handoff: "1", errors: "1", p50_router: "1640.5", p95_router: "2890" },
      [{ scenario: "SC17", turns: "3", avg_confidence: "0.9333" }],
      [],
    );
    expect(stats.turns).toBe(8);
    expect(stats.dialogs).toBe(3);
    expect(stats.share).toEqual({ run: 0.625, clarify: 0.25, handoff: 0.125 });
    expect(stats.errors).toBe(1);
    expect(stats.latency).toEqual({ p50: 1641, p95: 2890 });
    expect(stats.topScenarios).toEqual([{ scenario: "SC17", turns: 3, avgConfidence: 0.93 }]);
  });

  it("на пустом журнале возвращает нули, а не деление на ноль", () => {
    const stats = toSupervisorStats(
      { turns: "0", dialogs: "0", run: "0", clarify: "0", handoff: "0", errors: "0", p50_router: null, p95_router: null },
      [],
      [],
    );
    expect(stats.turns).toBe(0);
    expect(stats.share).toEqual({ run: 0, clarify: 0, handoff: 0 });
    expect(stats.latency).toEqual({ p50: null, p95: null });
  });

  it("сомнительный ход сохраняет реплику, сценарий, уверенность и действие", () => {
    const stats = toSupervisorStats(
      { turns: "1", dialogs: "1", run: "0", clarify: "1", handoff: "0", errors: "0", p50_router: "900", p95_router: "900" },
      [],
      [
        {
          created_at: "2026-09-23T11:05:00.000Z",
          transcript: "Страховка на машину",
          top_scenario: "SC03",
          top_confidence: "0.600",
          action_kind: "clarify",
          error: null,
        },
      ],
    );
    expect(stats.doubtful).toEqual([
      { at: "2026-09-23T11:05:00.000Z", transcript: "Страховка на машину", scenario: "SC03", confidence: 0.6, action: "clarify", error: null },
    ]);
  });
});
