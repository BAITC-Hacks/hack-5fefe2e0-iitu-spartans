import { replyLanguage, type Language } from "@voice-router/core";

/**
 * Серверный голосовой путь для кнопки микрофона: разбор ответа POST /api/stt и адрес озвучки GET /api/tts.
 * Браузерные распознавание и голос — запасной путь (без ключа модели или при сбое сервера, Положение §5.6.6).
 */

export type SttOutcome =
  | { ok: true; text: string; language?: Language; latencyMs: number }
  /** fallback — серверное распознавание недоступно, дальше слушает браузер; иначе клиент просто повторяет фразу. */
  | { ok: false; error: string; fallback: boolean };

/** Ошибки, после которых сервер остаётся рабочим: тишина или пустая запись — не сбой распознавания. */
const RETRYABLE = new Set(["empty", "no_audio"]);

export async function parseSttResponse(response: Response | null): Promise<SttOutcome> {
  if (!response) return { ok: false, error: "network", fallback: true };
  const body = (await response.json().catch(() => null)) as
    | { text?: string; language?: Language; latency_ms?: number; error?: string }
    | null;
  if (response.ok && body?.text) {
    return {
      ok: true,
      text: body.text,
      ...(body.language ? { language: body.language } : {}),
      latencyMs: body.latency_ms ?? 0,
    };
  }
  const error = body?.error ?? `http_${response.status}`;
  return { ok: false, error, fallback: !RETRYABLE.has(error) };
}

/** Озвучка идёт через <audio src>: браузер играет поток с первых байт, не дожидаясь всей записи. */
export function ttsUrl(text: string, language: Language): string {
  // Голос — на языке, на котором ядро написало текст ответа (смешанная реплика получает ответ по-русски).
  return `/api/tts?${new URLSearchParams({ lang: replyLanguage(language), text }).toString()}`;
}
