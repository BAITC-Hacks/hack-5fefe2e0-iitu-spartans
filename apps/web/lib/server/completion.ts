import type { RouterMessages } from "@voice-router/core";

/**
 * Вызов модели для LLM-маршрутизатора ядра через OpenAI-совместимый вход (Chat Completions). Поставщик задаётся
 * окружением: по умолчанию OpenAI, либо любой совместимый вход (ROUTER_BASE_URL + ROUTER_API_KEY), — так модели
 * сравниваются на одном dev-наборе с одним промптом. Ключи читаются только из окружения и в код не попадают.
 * Ответ запрашивается в формате JSON; проверку формата делает ядро (контракт RouteDecision).
 */

const OPENAI_BASE_URL = "https://api.openai.com/v1";
/** Модель по умолчанию — та, на которой замерена точность маршрутизации на dev-наборе; переопределяется ROUTER_MODEL. */
const DEFAULT_MODEL = "gpt-5.4-mini";
/** Предел ожидания ответа: дольше — это уже сбой связи для клиента, а не пауза (ТЗ: ориентир 1,5 с). */
const TIMEOUT_MS = 8000;

type Env = Record<string, string | undefined>;

export interface RouterProvider {
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort?: string;
}

/** Ключ OpenAI нужен голосу (распознавание и синтез); выбор сценария может идти и через другого поставщика. */
export function hasModelKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Поставщик модели выбора сценария по окружению или null, если ключа нет (тогда — демо-режим).
 * Compose передаёт незаданную переменную пустой строкой, поэтому пустое значение считается незаданным.
 */
export function routerProvider(env: Env = process.env): RouterProvider | null {
  const value = (name: string) => env[name] || undefined;
  const apiKey = value("ROUTER_API_KEY") ?? value("OPENAI_API_KEY");
  if (!apiKey) return null;
  const base = (value("ROUTER_BASE_URL") ?? OPENAI_BASE_URL).replace(/\/+$/, "");
  const model = value("ROUTER_MODEL") ?? DEFAULT_MODEL;
  const provider: RouterProvider = { endpoint: `${base}/chat/completions`, apiKey, model };
  // Модели семейства gpt-5 рассуждают по умолчанию; для выбора сценария рассуждение не нужно, а задержка растёт.
  // Другим моделям глубина передаётся, только если задана явно: не каждый поставщик принимает значение none.
  const effort = value("ROUTER_REASONING_EFFORT") ?? (model.startsWith("gpt-5") ? "none" : undefined);
  if (effort) provider.reasoningEffort = effort;
  return provider;
}

export async function completeWithOpenAI(messages: RouterMessages): Promise<string> {
  const provider = routerProvider();
  if (!provider) throw new Error("нет ключа модели выбора сценария");
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [
      { role: "system", content: messages.system },
      { role: "user", content: messages.user },
    ],
    response_format: { type: "json_object" },
  };
  if (provider.reasoningEffort) body.reasoning_effort = provider.reasoningEffort;

  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`model ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}
