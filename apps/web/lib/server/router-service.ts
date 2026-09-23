import { RouteDecisionSchema, type ClientDialogState, type RouteDecision } from "@voice-router/core";

/**
 * Вызов сервиса выбора сценария (FastAPI, ROUTER_URL) и пауза после его недоступности (ARCHITECTURE.md, ADR-015).
 */

/** Предел ожидания сервиса: его собственный таймаут модели — 6 с, после него он честно отвечает 504. */
const REQUEST_TIMEOUT_MS = 8000;

/** Сервис не ответил: имя не разрешилось, соединение отклонено или истёк таймаут самого HTTP-запроса. */
export class RouterServiceUnreachableError extends Error {}

export async function routeViaService(
  url: string,
  utterance: string,
  state: ClientDialogState,
  fetchImpl: typeof fetch = fetch,
): Promise<RouteDecision> {
  let response: Response;
  try {
    response = await fetchImpl(`${url.replace(/\/$/, "")}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ utterance, state }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new RouterServiceUnreachableError(e instanceof Error ? e.message : String(e), { cause: e });
  }
  // Всё ниже — сервис ответил, то есть жив: HTTP-ошибка (502/503/504) или ответ вне контракта.
  if (!response.ok) throw new Error(`router-service ${response.status}`);
  // Ответ сервиса — такой же недоверенный ввод, как ответ модели: проверяем тем же контрактом.
  return RouteDecisionSchema.parse(await response.json());
}

/**
 * Пауза включается, только когда сервис не отвечает: остановленный контейнер не отказывает сразу — имя в сети Compose
 * не разрешается ~5 с, и без паузы каждый ход ждал бы их. Ответ с HTTP-ошибкой (например, 504 — модель не уложилась
 * в таймаут) пауз не включает: этот ход идёт резервным путём, следующий — снова в сервис.
 */
export function createServiceGate(retryAfterMs: number, now: () => number = Date.now) {
  let pausedUntil = 0;
  return {
    isPaused: () => now() < pausedUntil,
    recordFailure(error: unknown) {
      if (error instanceof RouterServiceUnreachableError) pausedUntil = now() + retryAfterMs;
    },
  };
}
