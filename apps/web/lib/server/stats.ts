import type pg from "pg";

/**
 * Сводка журнала ходов для супервизора (ТЗ: супервизор видит, какие сценарии выбирались, где робот сомневался
 * и ошибся). Агрегаты считает база по окну времени на индексе created_at: приложение не выгружает строки журнала.
 */

/** Окно сводки: смена контакт-центра. Больше не нужно для демонстрации, а запрос остаётся лёгким. */
const WINDOW = "24 hours";
const TOP_LIMIT = 8;
const DOUBTFUL_LIMIT = 10;
/** Ниже этого порога политика не запускает сценарий сразу (ADR-004) — такой ход супервизор проверяет. */
const DOUBT_BELOW = 0.75;

type Num = string | number | null;

export interface TotalsRow {
  turns: Num;
  dialogs: Num;
  run: Num;
  clarify: Num;
  handoff: Num;
  errors: Num;
  p50_router: Num;
  p95_router: Num;
}
export interface TopRow {
  scenario: string;
  turns: Num;
  avg_confidence: Num;
}
export interface DoubtfulRow {
  created_at: string | Date;
  transcript: string;
  top_scenario: string | null;
  top_confidence: Num;
  action_kind: string;
  error: string | null;
}

export interface SupervisorStats {
  turns: number;
  dialogs: number;
  share: { run: number; clarify: number; handoff: number };
  errors: number;
  latency: { p50: number | null; p95: number | null };
  topScenarios: Array<{ scenario: string; turns: number; avgConfidence: number }>;
  doubtful: Array<{ at: string; transcript: string; scenario: string | null; confidence: number | null; action: string; error: string | null }>;
}

// pg отдаёт bigint и numeric строками; null остаётся null (нет данных — не ноль).
const num = (value: Num): number => Number(value ?? 0);
const maybe = (value: Num): number | null => (value === null ? null : Number(value));
const round2 = (value: number) => Math.round(value * 100) / 100;

export function toSupervisorStats(totals: TotalsRow, top: TopRow[], doubtful: DoubtfulRow[]): SupervisorStats {
  const turns = num(totals.turns);
  const share = (value: Num) => (turns === 0 ? 0 : num(value) / turns);
  const p50 = maybe(totals.p50_router);
  const p95 = maybe(totals.p95_router);
  return {
    turns,
    dialogs: num(totals.dialogs),
    share: { run: share(totals.run), clarify: share(totals.clarify), handoff: share(totals.handoff) },
    errors: num(totals.errors),
    latency: { p50: p50 === null ? null : Math.round(p50), p95: p95 === null ? null : Math.round(p95) },
    topScenarios: top.map((r) => ({ scenario: r.scenario, turns: num(r.turns), avgConfidence: round2(num(r.avg_confidence)) })),
    doubtful: doubtful.map((r) => ({
      at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      transcript: r.transcript,
      scenario: r.top_scenario,
      confidence: maybe(r.top_confidence),
      action: r.action_kind,
      error: r.error,
    })),
  };
}

export async function supervisorStats(pool: pg.Pool): Promise<SupervisorStats> {
  const since = `now() - interval '${WINDOW}'`;
  const [totals, top, doubtful] = await Promise.all([
    pool.query<TotalsRow>(
      `SELECT count(*) AS turns,
              count(DISTINCT dialog_id) AS dialogs,
              count(*) FILTER (WHERE action_kind = 'run') AS run,
              count(*) FILTER (WHERE action_kind = 'clarify') AS clarify,
              count(*) FILTER (WHERE action_kind = 'handoff') AS handoff,
              count(*) FILTER (WHERE error IS NOT NULL) AS errors,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY (latency_ms->>'router')::numeric) AS p50_router,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY (latency_ms->>'router')::numeric) AS p95_router
         FROM turns WHERE created_at > ${since}`,
    ),
    pool.query<TopRow>(
      `SELECT top_scenario AS scenario, count(*) AS turns, avg(top_confidence) AS avg_confidence
         FROM turns WHERE created_at > ${since} AND top_scenario IS NOT NULL
        GROUP BY top_scenario ORDER BY count(*) DESC, top_scenario LIMIT $1`,
      [TOP_LIMIT],
    ),
    pool.query<DoubtfulRow>(
      `SELECT created_at, transcript, top_scenario, top_confidence, action_kind, error
         FROM turns
        WHERE created_at > ${since}
          AND (action_kind IN ('clarify', 'handoff') OR top_confidence < $1 OR error IS NOT NULL)
        ORDER BY created_at DESC LIMIT $2`,
      [DOUBT_BELOW, DOUBTFUL_LIMIT],
    ),
  ]);
  return toSupervisorStats(totals.rows[0] as TotalsRow, top.rows, doubtful.rows);
}
