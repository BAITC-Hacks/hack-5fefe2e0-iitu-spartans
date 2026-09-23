import type { RouteDecision } from "../contracts/route-decision";

/**
 * Политика принятия решений: превращает ответ LLM-маршрутизатора в действие робота.
 *
 * Правила — раздел «Политика принятия решений» README стартового набора организаторов. Модуль не вызывает
 * модель и не читает данные: всё, что ему нужно, передаётся аргументами, поэтому он детерминирован и
 * полностью покрыт модульными тестами.
 */

/** Не ниже — сценарий запускается. */
export const RUN_THRESHOLD = 0.75;
/** Не ниже (и ниже RUN_THRESHOLD) — уточняющий вопрос; ниже — низкая уверенность. */
export const CLARIFY_THRESHOLD = 0.45;
/** Сколько раз подряд допустима низкая уверенность, прежде чем передать разговор оператору. */
export const LOW_CONFIDENCE_LIMIT = 2;
/** Сценарий «Запрос на соединение с оператором»: просьба клиента исполняется сразу. */
export const OPERATOR_REQUEST_SCENARIO = "SC37";

export type Priority = "normal" | "high" | "urgent";

export type PolicyAction =
  | { kind: "run"; queue: string[] }
  | { kind: "clarify"; options: string[] }
  | { kind: "continue"; scenarioId: string }
  | { kind: "handoff"; reason: "low_confidence_twice" | "client_request" };

export interface PolicyState {
  /** Сколько реплик подряд уверенность была ниже CLARIFY_THRESHOLD. */
  lowConfidenceStreak: number;
  /** Сценарий, который сейчас собирает данные или ждёт подтверждения. */
  activeScenario?: string;
}

export const INITIAL_POLICY_STATE: PolicyState = { lowConfidenceStreak: 0 };

export interface PolicyResult {
  action: PolicyAction;
  nextState: PolicyState;
}

/** Два самых вероятных различных сценария среди выбранных и альтернатив — варианты уточняющего вопроса. */
function topOptions(decision: RouteDecision, count = 2): string[] {
  const ranked = [...decision.scenarios, ...decision.alternatives].sort((a, b) => b.confidence - a.confidence);
  return [...new Set(ranked.map((s) => s.scenario_id))].slice(0, count);
}

export function decide(
  decision: RouteDecision,
  state: PolicyState,
  priorityOf: (scenarioId: string) => Priority,
): PolicyResult {
  // Продолжение активного сценария: заполняются слоты, маршрутизация не повторяется.
  if (decision.is_continuation && state.activeScenario) {
    return { action: { kind: "continue", scenarioId: state.activeScenario }, nextState: state };
  }

  // Просьба клиента соединить с оператором исполняется без переспроса.
  if (decision.scenarios.some((s) => s.scenario_id === OPERATOR_REQUEST_SCENARIO)) {
    return { action: { kind: "handoff", reason: "client_request" }, nextState: INITIAL_POLICY_STATE };
  }

  const accepted = decision.scenarios.filter((s) => s.confidence >= RUN_THRESHOLD);
  if (accepted.length > 0) {
    // Срочные — первыми; внутри групп сохраняется порядок упоминания (сортировка устойчивая).
    const queue = [...accepted]
      .sort((a, b) => Number(priorityOf(b.scenario_id) === "urgent") - Number(priorityOf(a.scenario_id) === "urgent"))
      .map((s) => s.scenario_id);
    const [first] = queue;
    return {
      action: { kind: "run", queue },
      nextState: first === undefined ? INITIAL_POLICY_STATE : { lowConfidenceStreak: 0, activeScenario: first },
    };
  }

  const top = Math.max(...decision.scenarios.map((s) => s.confidence));
  if (top >= CLARIFY_THRESHOLD) {
    return { action: { kind: "clarify", options: topOptions(decision) }, nextState: { ...state, lowConfidenceStreak: 0 } };
  }

  // Низкая уверенность: сначала переспрашиваем, повторная подряд — оператор, а не угадывание.
  const streak = state.lowConfidenceStreak + 1;
  if (streak >= LOW_CONFIDENCE_LIMIT) {
    return { action: { kind: "handoff", reason: "low_confidence_twice" }, nextState: INITIAL_POLICY_STATE };
  }
  return { action: { kind: "clarify", options: topOptions(decision) }, nextState: { ...state, lowConfidenceStreak: streak } };
}
