import { parseRouteDecision, type RouteDecision } from "../contracts/route-decision";
import { knownIds, type Catalog } from "./catalog";
import { buildRouterMessages, type DialogContext, type RouterMessages } from "./prompt";

/**
 * LLM-маршрутизатор: реплика + состояние диалога + каталог -> проверенное решение о сценарии.
 *
 * Модель подставляется функцией `complete`: слой не зависит от поставщика и проверяется тестами без сети.
 * Ответ модели — недоверенный ввод: он проходит контракт RouteDecision и проверку, что названные
 * сценарии есть в каталоге (защита от выдуманного идентификатора).
 */

export interface RouterDeps {
  /** Отправляет сообщения модели и возвращает сырой текст ответа. */
  complete(messages: RouterMessages): Promise<string>;
  /** Источник времени в миллисекундах; подставляется, чтобы замер задержки был проверяемым. */
  now(): number;
}

export interface RouteRequest {
  utterance: string;
  context: DialogContext;
  catalog: Catalog;
}

export type RouteError = "completion_failed" | "invalid_json" | "schema_mismatch" | "unknown_scenario";

export type RouteOutcome =
  | { ok: true; decision: RouteDecision; attempts: number; latencyMs: number }
  | { ok: false; error: RouteError; detail: string; attempts: number; latencyMs: number };

/** Один повтор: ошибка формата у модели случайна, повтор почти всегда её снимает; больше — растёт пауза в разговоре. */
export const MAX_ATTEMPTS = 2;

export async function routeUtterance(request: RouteRequest, deps: RouterDeps): Promise<RouteOutcome> {
  const messages = buildRouterMessages(request.catalog, request.context, request.utterance);
  const allowed = knownIds(request.catalog);
  const started = deps.now();
  let failure: { error: RouteError; detail: string } = { error: "completion_failed", detail: "" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await deps.complete(messages);
    } catch (error) {
      failure = { error: "completion_failed", detail: error instanceof Error ? error.message : String(error) };
      continue;
    }

    const parsed = parseRouteDecision(raw);
    if (!parsed.ok) {
      failure = { error: parsed.error, detail: parsed.issues?.join("; ") ?? parsed.error };
      continue;
    }

    const invented = [...parsed.decision.scenarios, ...parsed.decision.alternatives]
      .map((s) => s.scenario_id)
      .filter((id) => !allowed.has(id));
    if (invented.length > 0) {
      failure = { error: "unknown_scenario", detail: invented.join(", ") };
      continue;
    }

    return { ok: true, decision: parsed.decision, attempts: attempt, latencyMs: deps.now() - started };
  }

  return { ok: false, ...failure, attempts: MAX_ATTEMPTS, latencyMs: deps.now() - started };
}
