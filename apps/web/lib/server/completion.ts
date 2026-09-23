import type { RouterMessages } from "@voice-router/core";

/**
 * Вызов модели OpenAI для LLM-маршрутизатора ядра. Ключ читается только из окружения (OPENAI_API_KEY)
 * и в код не попадает. Ответ запрашивается в формате JSON; проверку формата делает ядро (контракт RouteDecision).
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
/** Модель по умолчанию — та, на которой замерена точность маршрутизации на dev-наборе; переопределяется ROUTER_MODEL. */
const DEFAULT_MODEL = "gpt-5.4-mini";
/** Предел ожидания ответа: дольше — это уже сбой связи для клиента, а не пауза (ТЗ: ориентир 1,5 с). */
const TIMEOUT_MS = 8000;

export function hasModelKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function completeWithOpenAI(messages: RouterMessages): Promise<string> {
  const model = process.env.ROUTER_MODEL ?? DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: messages.system },
      { role: "user", content: messages.user },
    ],
    response_format: { type: "json_object" },
  };
  // Модели семейства gpt-5 рассуждают по умолчанию; для выбора сценария рассуждение не нужно, а задержка растёт.
  if (model.startsWith("gpt-5")) body.reasoning_effort = process.env.ROUTER_REASONING_EFFORT ?? "none";

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}
