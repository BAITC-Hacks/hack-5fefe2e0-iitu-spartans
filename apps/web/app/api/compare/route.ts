import { z } from "zod";
import type { ClientDialogState } from "@voice-router/core";
import { loadCatalog, scenarioDisplayName } from "../../../lib/server/catalog";
import { compareEngines } from "../../../lib/server/compare";
import { completeWith, ENGINE_IDS, engineProvider } from "../../../lib/server/completion";

/**
 * Окно «Сравнить ChatGPT и Gemini»: одна реплика с текущим контекстом диалога уходит в оба движка одновременно,
 * панель показывает два решения рядом — сценарий, обоснование, альтернативы, задержку — и совпали ли они.
 *
 * Сравнение не участвует в пути диалога: состояние не меняется, ход в журнал не пишется, сервис выбора сценария
 * (ROUTER_URL) не задействован — оба движка идут через маршрутизатор ядра с одним промптом. Демо-режима здесь нет:
 * движок без ключа помечается недоступным, а не отвечает выдуманным решением.
 */
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  utterance: z.string().trim().min(1).max(2000),
  state: z.object({
    dialogId: z.string().uuid().optional(),
    language: z.enum(["ru", "kk", "mixed"]).optional(),
    activeScenario: z.string().optional(),
    lowConfidenceStreak: z.number().int().min(0).default(0),
    turnCount: z.number().int().min(0).optional(),
    history: z.array(z.object({ role: z.enum(["client", "bot"]), text: z.string() })).default([]),
  }),
});

/** Какие движки настроены: интерфейс показывает кнопку сравнения, только когда есть хотя бы один. */
export async function GET(): Promise<Response> {
  const engines = ENGINE_IDS.map((id) => {
    const provider = engineProvider(id);
    return { id, available: provider !== null, model: provider?.model ?? null };
  });
  return Response.json({ engines });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const { utterance } = parsed.data;
  const state: ClientDialogState = parsed.data.state as ClientDialogState;
  const { catalog, labels } = loadCatalog();

  const context = {
    history: state.history,
    ...(state.language ? { language: state.language } : {}),
    ...(state.activeScenario ? { activeScenario: state.activeScenario } : {}),
  };
  const result = await compareEngines(
    { utterance, context, catalog },
    ENGINE_IDS.map((id) => ({ id, provider: engineProvider(id) })),
    { complete: completeWith, nameOf: (id) => scenarioDisplayName(labels, id) },
  );
  return Response.json(result);
}
