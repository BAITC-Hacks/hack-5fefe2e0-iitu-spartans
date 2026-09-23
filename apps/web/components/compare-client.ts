import type { ClientDialogState, RouteDecision } from "@voice-router/core";
import type { TurnFailure } from "./turn-client";

/**
 * Вызовы /api/compare: список настроенных движков и сравнение одной реплики. Как и postTurn, никогда не бросает:
 * окно сравнения показывает причину сбоя и остаётся открытым, разговор не затрагивается.
 */

export type EngineId = "openai" | "gemini";

export interface EngineInfo {
  id: EngineId;
  available: boolean;
  model: string | null;
}

export interface EngineResult extends EngineInfo {
  decision: RouteDecision | null;
  error?: string;
  latencyMs: number;
  attempts: number;
}

export interface CompareResponse {
  utterance: string;
  engines: EngineResult[];
  agree: boolean | null;
  scenarioNames: Record<string, string>;
}

export type CompareResult = { ok: true; data: CompareResponse } | { ok: false; failure: TurnFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCompareResponse(value: unknown): value is CompareResponse {
  return isRecord(value) && Array.isArray(value.engines) && isRecord(value.scenarioNames) && typeof value.utterance === "string";
}

/** Какие движки настроены на сервере; при сбое — пустой список, кнопка сравнения не показывается. */
export async function fetchEngines(): Promise<EngineInfo[]> {
  try {
    const response = await fetch("/api/compare");
    if (!response.ok) return [];
    const body: unknown = await response.json();
    return isRecord(body) && Array.isArray(body.engines) ? (body.engines as EngineInfo[]) : [];
  } catch {
    return [];
  }
}

export async function postCompare(request: { utterance: string; state: ClientDialogState }, signal?: AbortSignal): Promise<CompareResult> {
  let response: Response;
  try {
    response = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    return { ok: false, failure: { kind: "network" } };
  }
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body: unknown = await response.json();
      if (isRecord(body) && typeof body.error === "string") detail = body.error;
    } catch {
      // Тело не JSON — достаточно кода ответа.
    }
    return { ok: false, failure: detail ? { kind: "http", status: response.status, detail } : { kind: "http", status: response.status } };
  }
  try {
    const body: unknown = await response.json();
    return isCompareResponse(body) ? { ok: true, data: body } : { ok: false, failure: { kind: "bad-response" } };
  } catch {
    return { ok: false, failure: { kind: "bad-response" } };
  }
}
