import type { RouteDecision } from "./route-decision";
import type { PolicyAction } from "../policy/decide";

/**
 * Контракт одного хода диалога между веб-интерфейсом и сервером (POST /api/turn).
 *
 * Сервер не хранит сессию: состояние диалога возвращается клиенту и приходит обратно со следующей репликой.
 * Так ход воспроизводим по одному запросу, а трассировка содержит всё, что нужно супервизору.
 */

export type Language = "ru" | "kk" | "mixed";

export interface DialogTurn {
  role: "client" | "bot";
  text: string;
}

/** Состояние диалога, которое клиент хранит и отправляет с каждой репликой. */
export interface ClientDialogState {
  /** Выдаётся сервером на первом ходе; по нему ходы связываются в журнале для панели супервизора. */
  dialogId?: string;
  language?: Language;
  activeScenario?: string;
  lowConfidenceStreak: number;
  /** Число завершённых ходов. История обрезается, поэтому номер хода считается по счётчику, а не по её длине. */
  turnCount?: number;
  history: DialogTurn[];
}

export const INITIAL_CLIENT_STATE: ClientDialogState = { lowConfidenceStreak: 0, history: [] };

export interface TurnRequest {
  utterance: string;
  state: ClientDialogState;
  /** Задержка распознавания речи на стороне браузера, если реплика пришла голосом. */
  sttMs?: number;
}

/** Задержка по этапам хода в миллисекундах (ТЗ: панель трассировки, время по этапам). */
export interface TurnLatency {
  stt?: number;
  router: number;
  response: number;
  total: number;
  /**
   * От готового текста ответа до первого звука озвучки. Измеряется в браузере после ответа сервера, поэтому
   * в журнал ходов не попадает; нет у текстовых ответов без озвучки.
   */
  ttsFirstAudio?: number;
}

export interface TurnTrace {
  turn: number;
  transcript: string;
  language: Language;
  /** Откуда пришло решение: сервис FastAPI, маршрутизатор ядра с моделью или демо-режим без ключа. */
  source: "router-service" | "core-llm" | "demo";
  decision: RouteDecision | null;
  action: PolicyAction;
  /** Названия сценариев из каталога для отображения в панели: SC17 -> "Claim status". */
  scenarioNames: Record<string, string>;
  error?: string;
  latencyMs: TurnLatency;
}

export interface TurnResponse {
  reply: { text: string; language: Language };
  trace: TurnTrace;
  state: ClientDialogState;
}
