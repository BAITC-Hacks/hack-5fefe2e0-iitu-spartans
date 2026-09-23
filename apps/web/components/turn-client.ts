import type { TurnRequest, TurnResponse } from "@voice-router/core";

/**
 * Вызов POST /api/turn. Никогда не бросает исключение: интерфейс показывает ошибку в ленте разговора
 * и остаётся рабочим, а состояние диалога не меняется, чтобы клиент мог просто повторить реплику.
 */

export type TurnFailure =
  | { kind: "http"; status: number; detail?: string }
  | { kind: "network" }
  | { kind: "bad-response" };

export type TurnResult = { ok: true; data: TurnResponse } | { ok: false; failure: TurnFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Ответ сервера — внешний ввод: проверяем минимум, без которого экран не отрисовать,
// чтобы несовместимая версия API дала понятное сообщение, а не падение компонента.
function isTurnResponse(value: unknown): value is TurnResponse {
  if (!isRecord(value) || !isRecord(value.reply) || !isRecord(value.trace) || !isRecord(value.state)) return false;
  return (
    typeof value.reply.text === "string" &&
    isRecord(value.trace.latencyMs) &&
    isRecord(value.trace.action) &&
    Array.isArray(value.state.history)
  );
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    // Тело не JSON (например, страница 404 от Next.js) — достаточно кода ответа.
  }
  return undefined;
}

export async function postTurn(request: TurnRequest, signal?: AbortSignal): Promise<TurnResult> {
  let response: Response;
  try {
    response = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    return { ok: false, failure: { kind: "network" } };
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    return { ok: false, failure: detail ? { kind: "http", status: response.status, detail } : { kind: "http", status: response.status } };
  }

  try {
    const body: unknown = await response.json();
    return isTurnResponse(body) ? { ok: true, data: body } : { ok: false, failure: { kind: "bad-response" } };
  } catch {
    return { ok: false, failure: { kind: "bad-response" } };
  }
}
