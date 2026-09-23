import { describe, expect, it } from "vitest";
import type { RouteDecision } from "../contracts/route-decision";
import { decide, INITIAL_POLICY_STATE, type Priority } from "./decide";

// Пороги и порядок — из раздела «Политика принятия решений» README стартового набора организаторов:
// confidence >= 0.75 — запуск; 0.45–0.75 — уточняющий вопрос с двумя вариантами;
// < 0.45 два раза подряд или по просьбе клиента — оператор; несколько сценариев — сначала urgent;
// продолжение активного сценария — без повторной маршрутизации.

// Приоритеты по таблице сценариев README: срочные — SC11, SC15, SC38.
const PRIORITY: Record<string, Priority> = { SC11: "urgent", SC15: "urgent", SC38: "urgent" };
const priorityOf = (id: string): Priority => PRIORITY[id] ?? "normal";

const decision = (
  scenarios: Array<[string, number]>,
  extra: Partial<RouteDecision> = {},
): RouteDecision => ({
  scenarios: scenarios.map(([scenario_id, confidence]) => ({ scenario_id, confidence, reason: "test" })),
  alternatives: [],
  language: "ru",
  slots: {},
  is_continuation: false,
  ...extra,
});

describe("decide — политика принятия решений", () => {
  it("запускает сценарий при уверенности не ниже 0.75", () => {
    const { action } = decide(decision([["SC01", 0.9]]), INITIAL_POLICY_STATE, priorityOf);
    expect(action).toEqual({ kind: "run", queue: ["SC01"] });
  });

  it("граница 0.75 включительно — запуск, чуть ниже — уточнение", () => {
    expect(decide(decision([["SC01", 0.75]]), INITIAL_POLICY_STATE, priorityOf).action.kind).toBe("run");
    expect(decide(decision([["SC01", 0.7499]]), INITIAL_POLICY_STATE, priorityOf).action.kind).toBe("clarify");
  });

  it("несколько намерений выполняет в порядке упоминания", () => {
    const { action } = decide(decision([["SC30", 0.86], ["SC29", 0.78]]), INITIAL_POLICY_STATE, priorityOf);
    expect(action).toEqual({ kind: "run", queue: ["SC30", "SC29"] });
  });

  it("срочный сценарий ставит первым независимо от порядка упоминания", () => {
    const { action } = decide(decision([["SC29", 0.8], ["SC11", 0.9]]), INITIAL_POLICY_STATE, priorityOf);
    expect(action).toEqual({ kind: "run", queue: ["SC11", "SC29"] });
  });

  it("при уверенности 0.45–0.75 задаёт уточняющий вопрос с двумя самыми вероятными вариантами", () => {
    const d = decision([["SC17", 0.6]], { alternatives: [{ scenario_id: "SC19", confidence: 0.55 }, { scenario_id: "SC18", confidence: 0.2 }] });
    const { action } = decide(d, INITIAL_POLICY_STATE, priorityOf);
    expect(action).toEqual({ kind: "clarify", options: ["SC17", "SC19"] });
  });

  it("первая низкая уверенность — уточнение, вторая подряд — передача оператору", () => {
    const low = decision([["SC40", 0.3]]);
    const first = decide(low, INITIAL_POLICY_STATE, priorityOf);
    expect(first.action.kind).toBe("clarify");
    const second = decide(low, first.nextState, priorityOf);
    expect(second.action).toEqual({ kind: "handoff", reason: "low_confidence_twice" });
  });

  it("низкие уверенности не подряд не приводят к передаче оператору", () => {
    const s1 = decide(decision([["SC40", 0.3]]), INITIAL_POLICY_STATE, priorityOf).nextState;
    const s2 = decide(decision([["SC40", 0.6]]), s1, priorityOf).nextState;
    const third = decide(decision([["SC40", 0.3]]), s2, priorityOf);
    expect(third.action.kind).toBe("clarify");
  });

  it("просьба соединить с оператором (SC37) — сразу передача оператору", () => {
    const { action } = decide(decision([["SC37", 0.95]]), INITIAL_POLICY_STATE, priorityOf);
    expect(action).toEqual({ kind: "handoff", reason: "client_request" });
  });

  it("продолжение активного сценария не запускает маршрутизацию заново", () => {
    const state = { ...INITIAL_POLICY_STATE, activeScenario: "SC02" };
    const { action } = decide(decision([["SC01", 0.9]], { is_continuation: true }), state, priorityOf);
    expect(action).toEqual({ kind: "continue", scenarioId: "SC02" });
  });

  it("запуск сценария сбрасывает счётчик низкой уверенности и запоминает активный сценарий", () => {
    const s1 = decide(decision([["SC40", 0.3]]), INITIAL_POLICY_STATE, priorityOf).nextState;
    const { nextState } = decide(decision([["SC21", 0.9]]), s1, priorityOf);
    expect(nextState).toEqual({ lowConfidenceStreak: 0, activeScenario: "SC21" });
  });
});
