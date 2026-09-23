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
  | { kind: "continue"; scenarioId: string; /** Какие параметры сценария клиент назвал этой репликой. */ filled: string[] }
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

/** Системные намерения (непонятно, вне тематики, прощание) — не сценарии: их нельзя продолжать и предлагать как вариант. */
function isSystemIntent(id: string): boolean {
  return id.startsWith("SYS_");
}

/** Два самых вероятных различных сценария среди выбранных и альтернатив — варианты уточняющего вопроса. */
function topOptions(decision: RouteDecision, count = 2): string[] {
  // Модель сама назвала реплику непонятной или не по теме (приветствие, светская фраза): хвостовые альтернативы —
  // шум, и «вы хотите расчёт ОГПО или другое?» на «как дела?» звучит как угадывание. Без вариантов — открытый вопрос.
  const primary = decision.scenarios[0]?.scenario_id;
  if (primary !== undefined && isSystemIntent(primary)) return [];
  const ranked = [...decision.scenarios, ...decision.alternatives].sort((a, b) => b.confidence - a.confidence);
  // «Вы хотите SYS_UNCLEAR или другое?» — клиент не должен слышать служебные идентификаторы.
  return [...new Set(ranked.map((s) => s.scenario_id).filter((id) => !isSystemIntent(id)))].slice(0, count);
}

export function decide(
  decision: RouteDecision,
  state: PolicyState,
  priorityOf: (scenarioId: string) => Priority,
): PolicyResult {
  // Продолжение активного сценария: заполняются слоты, маршрутизация не повторяется.
  // Если модель при этом назвала системное намерение (реплика непонятна или вне тематики), продолжать нечего —
  // решение принимается по порогам ниже, и клиент получает вопрос, а не «продолжаем».
  const primary = decision.scenarios[0]?.scenario_id;
  if (decision.is_continuation && state.activeScenario && !(primary !== undefined && isSystemIntent(primary))) {
    return {
      action: { kind: "continue", scenarioId: state.activeScenario, filled: Object.keys(decision.slots) },
      nextState: state,
    };
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
    // Системное намерение не становится активным сценарием: непонятная реплика не сбрасывает тему разговора,
    // прощание — завершает его.
    const nextState: PolicyState =
      first === undefined || first === "SYS_GOODBYE"
        ? INITIAL_POLICY_STATE
        : isSystemIntent(first)
          ? { ...state, lowConfidenceStreak: 0 }
          : { lowConfidenceStreak: 0, activeScenario: first };
    return { action: { kind: "run", queue }, nextState };
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
