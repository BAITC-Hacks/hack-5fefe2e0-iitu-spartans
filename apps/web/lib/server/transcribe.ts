import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildTranscriptionHints,
  GlossarySchema,
  toTranscriptionFormFields,
  type SttModel,
  type TranscriptionHints,
} from "@voice-router/core/stt";

/**
 * Серверное распознавание речи через OpenAI (ТЗ: жюри говорит в микрофон, две реплики на казахском и одна
 * со смешением языков). Распознавание браузера слушает один заранее выбранный язык и режет смешанную фразу;
 * модель gpt-transcribe получает оба ожидаемых языка и подсказку из словаря терминов набора (#8, #25).
 */

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL: SttModel = "gpt-transcribe";
/** Дольше ждать распознавания нет смысла: клиент уже слышит паузу, ход лучше повторить. */
const TIMEOUT_MS = 10_000;

export type TranscribeResult = { ok: true; text: string; ms: number } | { ok: false; error: string };

export interface TranscribeDeps {
  fetch: typeof fetch;
  apiKey: string;
  now: () => number;
}

export async function transcribe(
  audio: Blob,
  fileName: string,
  hints: TranscriptionHints,
  deps: TranscribeDeps,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("file", audio, fileName);
  for (const [name, value] of toTranscriptionFormFields(hints)) form.append(name, value);
  form.append("response_format", "json");

  const started = deps.now();
  let response: Response;
  try {
    response = await deps.fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network" };
  }
  if (!response.ok) return { ok: false, error: `http_${response.status}` };

  const body = (await response.json()) as { text?: string };
  const text = body.text?.trim() ?? "";
  // Пустая расшифровка — это тишина или шум зала; отвечать на неё нельзя, клиент ничего не просил.
  if (!text) return { ok: false, error: "empty" };
  return { ok: true, text, ms: deps.now() - started };
}

// Словарь терминов собран из данных набора скриптом glossary-build и лежит рядом с модулем STT ядра.
const GLOSSARY_FILE =
  process.env.STT_GLOSSARY ||
  path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../../packages/core/src/stt/stt-glossary.json");

let cachedHints: TranscriptionHints | null = null;

/** Подсказка для модели распознавания: строится один раз на процесс, словарь проверяется схемой. */
export function transcriptionHints(): TranscriptionHints {
  if (cachedHints) return cachedHints;
  const glossary = GlossarySchema.parse(JSON.parse(readFileSync(GLOSSARY_FILE, "utf8")));
  // Compose передаёт незаданную переменную пустой строкой, поэтому ||, а не ??.
  const model = (process.env.STT_MODEL || DEFAULT_MODEL) as SttModel;
  cachedHints = buildTranscriptionHints(glossary, { model });
  return cachedHints;
}
