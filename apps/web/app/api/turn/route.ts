import { z } from "zod";
import {
  buildReply,
  decide,
  demoDecision,
  routeUtterance,
  type ClientDialogState,
  type RouteDecision,
  type TurnResponse,
  type TurnTrace,
} from "@voice-router/core";
import { loadCatalog } from "../../../lib/server/catalog";
import { completeWithOpenAI, hasModelKey } from "../../../lib/server/completion";
import { pool } from "../../../lib/server/db";
import { recordTurn } from "../../../lib/server/journal";
import { createServiceGate, routeViaService } from "../../../lib/server/router-service";

/**
 * Один ход диалога: реплика -> выбор сценария -> политика -> ответ из данных набора -> трассировка.
 *
 * Источник решения выбирается по окружению, система работает в любом из трёх вариантов:
 * ROUTER_URL — сервис выбора сценария (FastAPI, основной путь); OPENAI_API_KEY — LLM-маршрутизатор ядра;
 * без обоих — демо-режим для проверки без личных ключей (Положение §5.6.6).
 * Если сервис недоступен или ответил ошибкой, ход не обрывается: решение принимает резервный путь
 * (маршрутизатор ядра или демо-режим), причина сбоя сервиса попадает в трассировку. Пауза в опросе
 * сервиса — только когда он не отвечает (ADR-015).
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
  sttMs: z.number().min(0).optional(),
});

/** Сколько реплик истории хранить в состоянии: достаточно для контекста, не раздувает промпт. */
const HISTORY_LIMIT = 12;

/** Не отвечающий сервис выбора сценария 30 с не опрашивается; ответ с HTTP-ошибкой паузу не включает (ADR-015). */
const serviceGate = createServiceGate(30_000);

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const { utterance, sttMs } = parsed.data;
  const state: ClientDialogState = parsed.data.state as ClientDialogState;
  const { catalog, labels, priorityOf } = loadCatalog();

  let decision: RouteDecision | null = null;
  let source: TurnTrace["source"] = "demo";
  let error: string | undefined;
  const routerStarted = Date.now();
  const serviceUrl = process.env.ROUTER_URL;

  if (serviceUrl && serviceGate.isPaused()) {
    error = "router-service не отвечает, повтор после паузы";
  } else if (serviceUrl) {
    source = "router-service";
    try {
      decision = await routeViaService(serviceUrl, utterance, state);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      serviceGate.recordFailure(e);
    }
  }
  if (!decision) {
    if (hasModelKey()) {
      source = "core-llm";
      const context = {
        history: state.history,
        ...(state.language ? { language: state.language } : {}),
        ...(state.activeScenario ? { activeScenario: state.activeScenario } : {}),
      };
      const outcome = await routeUtterance({ utterance, context, catalog }, { complete: completeWithOpenAI, now: Date.now });
      if (outcome.ok) decision = outcome.decision;
      else error = [error, `${outcome.error}: ${outcome.detail}`].filter(Boolean).join("; ");
    } else {
      source = "demo";
      decision = demoDecision(catalog, utterance);
    }
  }
  const routerMs = Date.now() - routerStarted;

  // Сбой маршрутизатора не обрывает разговор: политика получает уточнение с низкой уверенностью.
  const effective: RouteDecision = decision ?? {
    scenarios: [{ scenario_id: "SYS_UNCLEAR", confidence: 0.3, reason: "маршрутизатор недоступен" }],
    alternatives: [],
    language: state.language ?? "ru",
    slots: {},
    is_continuation: false,
  };

  const responseStarted = Date.now();
  const policyState = {
    lowConfidenceStreak: state.lowConfidenceStreak,
    ...(state.activeScenario ? { activeScenario: state.activeScenario } : {}),
  };
  const { action, nextState } = decide(effective, policyState, priorityOf);
  const replyText = buildReply(action, effective.language, catalog, labels);
  const responseMs = Date.now() - responseStarted;

  const named = [...effective.scenarios, ...effective.alternatives].map((s) => s.scenario_id);
  // Для панели — название без кавычек и с заглавной буквы; кавычки нужны только внутри фразы робота.
  const displayName = (id: string) => {
    const name = labels.ru[id]?.replace(/^«|»$/g, "");
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : id;
  };
  const scenarioNames = Object.fromEntries(named.map((id) => [id, displayName(id)]));
  const turn = (state.turnCount ?? Math.floor(state.history.length / 2)) + 1;

  const dialogId = state.dialogId ?? crypto.randomUUID();
  const nextClientState: ClientDialogState = {
    dialogId,
    language: effective.language,
    lowConfidenceStreak: nextState.lowConfidenceStreak,
    turnCount: turn,
    history: [
      ...state.history,
      { role: "client" as const, text: utterance },
      { role: "bot" as const, text: replyText },
    ].slice(-HISTORY_LIMIT),
    ...(nextState.activeScenario ? { activeScenario: nextState.activeScenario } : {}),
  };

  const body: TurnResponse = {
    reply: { text: replyText, language: effective.language },
    trace: {
      turn,
      transcript: utterance,
      language: effective.language,
      source,
      decision,
      action,
      scenarioNames,
      ...(error ? { error } : {}),
      latencyMs: {
        ...(sttMs !== undefined ? { stt: Math.round(sttMs) } : {}),
        router: routerMs,
        response: responseMs,
        total: Date.now() - started + (sttMs ?? 0),
      },
    },
    state: nextClientState,
  };
  // Журнал пишется после расчёта задержки хода: запись в базу не влияет на замер и не обрывает разговор при сбое.
  if (pool) await recordTurn(pool, dialogId, body.trace, replyText);
  return Response.json(body);
}
