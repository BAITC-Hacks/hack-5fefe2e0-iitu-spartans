import type { RouterMessages } from "@voice-router/core";

/**
 * Вызов модели для LLM-маршрутизатора ядра через OpenAI-совместимый вход (Chat Completions). Поставщик задаётся
 * окружением: по умолчанию OpenAI, либо любой совместимый вход (ROUTER_BASE_URL + ROUTER_API_KEY), — так модели
 * сравниваются на одном dev-наборе с одним промптом. Ключи читаются только из окружения и в код не попадают.
 * Ответ запрашивается в формате JSON; проверку формата делает ядро (контракт RouteDecision).
 *
 * Именованные движки (`engineProvider`) нужны окну сравнения: одна реплика уходит в OpenAI и в Gemini одновременно
 * через один и тот же вход Chat Completions — различаются только адрес, ключ и модель.
 */

const OPENAI_BASE_URL = "https://api.openai.com/v1";
/** OpenAI-совместимый вход Google Gemini: тот же формат запроса и ответа, что у Chat Completions. */
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
/** Модель по умолчанию — та, на которой замерена точность маршрутизации на dev-наборе; переопределяется ROUTER_MODEL. */
const DEFAULT_MODEL = "gpt-5.4-mini";
/** Модель Gemini по умолчанию для окна сравнения; переопределяется GEMINI_MODEL. */
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
/** Предел ожидания ответа: дольше — это уже сбой связи для клиента, а не пауза (ТЗ: ориентир 1,5 с). */
const TIMEOUT_MS = 8000;

type Env = Record<string, string | undefined>;

export interface RouterProvider {
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
}

/** Движки окна сравнения. Порядок — порядок колонок в интерфейсе. */
export type EngineId = "openai" | "gemini";
export const ENGINE_IDS: readonly EngineId[] = ["openai", "gemini"];
/** Какая переменная окружения включает движок: интерфейс показывает её, когда ключа нет. */
export const ENGINE_KEY_ENV: Record<EngineId, string> = { openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" };

/** Compose передаёт незаданную переменную пустой строкой, поэтому пустое значение считается незаданным. */
function value(env: Env, name: string): string | undefined {
  return env[name] || undefined;
}

function provider(base: string, apiKey: string, model: string, explicitEffort: string | undefined): RouterProvider {
  const result: RouterProvider = { endpoint: `${base.replace(/\/+$/, "")}/chat/completions`, apiKey, model };
  // Модели семейства gpt-5 рассуждают по умолчанию; для выбора сценария рассуждение не нужно, а задержка растёт.
  // Другим моделям глубина передаётся, только если задана явно: не каждый поставщик принимает значение none.
  const effort = explicitEffort ?? (model.startsWith("gpt-5") ? "none" : undefined);
  if (effort) result.reasoningEffort = effort;
  return result;
}

/** Ключ OpenAI нужен голосу (распознавание и синтез); выбор сценария может идти и через другого поставщика. */
export function hasModelKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Поставщик модели выбора сценария по окружению или null, если ключа нет (тогда — демо-режим). */
export function routerProvider(env: Env = process.env): RouterProvider | null {
  const apiKey = value(env, "ROUTER_API_KEY") ?? value(env, "OPENAI_API_KEY");
  if (!apiKey) return null;
  return provider(
    value(env, "ROUTER_BASE_URL") ?? OPENAI_BASE_URL,
    apiKey,
    value(env, "ROUTER_MODEL") ?? DEFAULT_MODEL,
    value(env, "ROUTER_REASONING_EFFORT"),
  );
}

/**
 * Именованный движок для окна сравнения или null, если его ключ не задан.
 * ROUTER_MODEL относится к движку OpenAI только пока другой поставщик не задан через ROUTER_BASE_URL:
 * иначе это имя модели чужого входа, и OpenAI получает модель по умолчанию.
 */
export function engineProvider(id: EngineId, env: Env = process.env): RouterProvider | null {
  if (id === "openai") {
    const apiKey = value(env, "OPENAI_API_KEY");
    if (!apiKey) return null;
    const model = (value(env, "ROUTER_BASE_URL") ? undefined : value(env, "ROUTER_MODEL")) ?? DEFAULT_MODEL;
    return provider(OPENAI_BASE_URL, apiKey, model, value(env, "ROUTER_REASONING_EFFORT"));
  }
  const apiKey = value(env, "GEMINI_API_KEY");
  if (!apiKey) return null;
  return provider(GEMINI_BASE_URL, apiKey, value(env, "GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL, value(env, "GEMINI_REASONING_EFFORT"));
}

/** Функция `complete` для ядра, привязанная к конкретному поставщику. */
export function completeWith(target: RouterProvider): (messages: RouterMessages) => Promise<string> {
  return async (messages) => {
    const body: Record<string, unknown> = {
      model: target.model,
      messages: [
        { role: "system", content: messages.system },
        { role: "user", content: messages.user },
      ],
      response_format: { type: "json_object" },
    };
    if (target.reasoningEffort) body.reasoning_effort = target.reasoningEffort;

    const response = await fetch(target.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`model ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? "";
  };
}

export async function completeWithOpenAI(messages: RouterMessages): Promise<string> {
  const target = routerProvider();
  if (!target) throw new Error("нет ключа модели выбора сценария");
  return completeWith(target)(messages);
}
