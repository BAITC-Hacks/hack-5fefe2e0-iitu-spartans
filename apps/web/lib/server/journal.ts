import type { TurnTrace } from "@voice-router/core";
import type pg from "pg";

/**
 * Журнал ходов диалога (миграция 001). Запись — best effort: сбой базы не должен обрывать разговор,
 * поэтому ошибка записи логируется, а ход завершается как обычно.
 */

export interface TurnRow {
  dialog_id: string;
  turn_no: number;
  transcript: string;
  language: string;
  source: string;
  action_kind: string;
  top_scenario: string | null;
  top_confidence: number | null;
  decision: string | null;
  reply: string;
  error: string | null;
  latency_ms: string;
}

/** Строка журнала из трассировки хода. Сценарий и уверенность — отдельными полями для статистики и фильтра. */
export function toTurnRow(dialogId: string, trace: TurnTrace, reply: string): TurnRow {
  const top = trace.decision?.scenarios[0];
  return {
    dialog_id: dialogId,
    turn_no: trace.turn,
    transcript: trace.transcript,
    language: trace.language,
    source: trace.source,
    action_kind: trace.action.kind,
    top_scenario: top?.scenario_id ?? null,
    top_confidence: top?.confidence ?? null,
    decision: trace.decision ? JSON.stringify(trace.decision) : null,
    reply,
    error: trace.error ?? null,
    latency_ms: JSON.stringify(trace.latencyMs),
  };
}

export async function recordTurn(pool: pg.Pool, dialogId: string, trace: TurnTrace, reply: string): Promise<boolean> {
  const row = toTurnRow(dialogId, trace, reply);
  try {
    await pool.query("INSERT INTO dialogs (dialog_id) VALUES ($1) ON CONFLICT (dialog_id) DO NOTHING", [dialogId]);
    await pool.query(
      `INSERT INTO turns (dialog_id, turn_no, transcript, language, source, action_kind,
                          top_scenario, top_confidence, decision, reply, error, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (dialog_id, turn_no) DO NOTHING`,
      [row.dialog_id, row.turn_no, row.transcript, row.language, row.source, row.action_kind,
        row.top_scenario, row.top_confidence, row.decision, row.reply, row.error, row.latency_ms],
    );
    return true;
  } catch (error) {
    console.error("журнал ходов: запись не выполнена —", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Последние ходы для панели супервизора: сортировка по индексу created_at, число строк ограничено. */
export async function recentTurns(pool: pg.Pool, limit: number) {
  const { rows } = await pool.query(
    `SELECT dialog_id, turn_no, created_at, transcript, language, source, action_kind,
            top_scenario, top_confidence::float AS top_confidence, reply, error, latency_ms
       FROM turns ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
