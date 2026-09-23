import { routeUtterance, type RouteDecision, type RouteRequest, type RouterMessages } from "@voice-router/core";
import type { EngineId, RouterProvider } from "./completion";

/**
 * Сравнение движков выбора сценария: одна реплика с одним контекстом уходит в каждый настроенный движок,
 * результаты кладутся рядом. Это инструмент супервизора: он не меняет состояние диалога и не пишется в журнал,
 * а оба движка идут одним путём — маршрутизатор ядра с одним промптом и одной проверкой ответа (RouteDecision),
 * чтобы сравнение было честным: различается только модель.
 */

export interface EngineSpec {
  id: EngineId;
  /** null — ключ движка не задан; в ответе он помечается недоступным, решение за него не выдумывается. */
  provider: RouterProvider | null;
}

export interface EngineResult {
  id: EngineId;
  model: string | null;
  available: boolean;
  decision: RouteDecision | null;
  /** Ошибка маршрутизатора для этого движка: сбой модели, ответ не JSON, выдуманный сценарий. */
  error?: string;
  latencyMs: number;
  attempts: number;
}

export interface CompareResult {
  utterance: string;
  engines: EngineResult[];
  /** true/false — не меньше двух движков ответили и их основной сценарий совпал/не совпал; null — сравнивать нечего. */
  agree: boolean | null;
  scenarioNames: Record<string, string>;
}

export interface CompareDeps {
  /** Строит функцию `complete` ядра для поставщика; в тестах подменяется без сети. */
  complete: (provider: RouterProvider) => (messages: RouterMessages) => Promise<string>;
  /** Название сценария для панели по идентификатору. */
  nameOf: (id: string) => string;
  now?: () => number;
}

async function runEngine(request: RouteRequest, engine: EngineSpec, deps: CompareDeps): Promise<EngineResult> {
  if (!engine.provider) return { id: engine.id, model: null, available: false, decision: null, latencyMs: 0, attempts: 0 };
  const outcome = await routeUtterance(request, { complete: deps.complete(engine.provider), now: deps.now ?? Date.now });
  const base = { id: engine.id, model: engine.provider.model, available: true, latencyMs: outcome.latencyMs, attempts: outcome.attempts };
  return outcome.ok
    ? { ...base, decision: outcome.decision }
    : { ...base, decision: null, error: `${outcome.error}: ${outcome.detail}` };
}

export async function compareEngines(request: RouteRequest, engines: EngineSpec[], deps: CompareDeps): Promise<CompareResult> {
  // Движки опрашиваются одновременно: время сравнения — время самого медленного, а не сумма.
  const results = await Promise.all(engines.map((engine) => runEngine(request, engine, deps)));

  const primaries = results.map((r) => r.decision?.scenarios[0]?.scenario_id).filter((id): id is string => Boolean(id));
  const agree = primaries.length >= 2 ? primaries.every((id) => id === primaries[0]) : null;

  const ids = new Set<string>();
  for (const r of results) {
    for (const s of [...(r.decision?.scenarios ?? []), ...(r.decision?.alternatives ?? [])]) ids.add(s.scenario_id);
  }
  const scenarioNames = Object.fromEntries([...ids].map((id) => [id, deps.nameOf(id)]));

  return { utterance: request.utterance, engines: results, agree, scenarioNames };
}
