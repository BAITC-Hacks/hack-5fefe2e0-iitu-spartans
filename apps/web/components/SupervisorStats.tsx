"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../lib/i18n";

interface Stats {
  turns: number;
  dialogs: number;
  share: { run: number; clarify: number; handoff: number };
  errors: number;
  latency: { p50: number | null; p95: number | null };
  topScenarios: Array<{ scenario: string; turns: number; avgConfidence: number }>;
  doubtful: Array<{ at: string; transcript: string; scenario: string | null; confidence: number | null; action: string; error: string | null }>;
  names: Record<string, string>;
}

const ACTION_LABEL: Record<string, MessageKey> = {
  run: "stats.action.run",
  clarify: "stats.action.clarify",
  handoff: "stats.action.handoff",
  continue: "stats.action.continue",
};

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Сводка журнала за смену: доли действий, частые сценарии и ходы, где робот сомневался (ТЗ: супервизор видит,
 * где робот сомневался и ошибся). Обновляется по событию — после каждого хода и по кнопке, без опроса.
 */
export function SupervisorStats({ refreshKey }: { refreshKey: number }) {
  const { t } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/stats", { cache: "no-store" });
      const body = (await response.json()) as Stats & { error?: string };
      if (!response.ok) throw new Error(body.error ?? String(response.status));
      setStats(body);
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="section stats">
      <div className="stats__header">
        <h3 className="section__title">{t("stats.title")}</h3>
        <button type="button" className="button button--ghost button--small" onClick={() => void load()}>
          {t("stats.refresh")}
        </button>
      </div>
      {failure ? <p className="muted">{t("stats.unavailable", { reason: failure })}</p> : null}
      {stats && stats.turns === 0 ? <p className="muted">{t("stats.empty")}</p> : null}
      {stats && stats.turns > 0 ? (
        <>
          <dl className="stats__kpis">
            <div>
              <dt>{t("stats.turns")}</dt>
              <dd>{stats.turns}</dd>
            </div>
            <div>
              <dt>{t("stats.dialogs")}</dt>
              <dd>{stats.dialogs}</dd>
            </div>
            <div>
              <dt>{t("stats.errors")}</dt>
              <dd>{stats.errors}</dd>
            </div>
            <div>
              <dt>{t("stats.run")}</dt>
              <dd>{percent(stats.share.run)}</dd>
            </div>
            <div>
              <dt>{t("stats.clarify")}</dt>
              <dd>{percent(stats.share.clarify)}</dd>
            </div>
            <div>
              <dt>{t("stats.handoff")}</dt>
              <dd>{percent(stats.share.handoff)}</dd>
            </div>
            <div className="stats__wide">
              <dt>{t("stats.latency")}</dt>
              <dd>
                {stats.latency.p50 ?? "—"} / {stats.latency.p95 ?? "—"}
              </dd>
            </div>
          </dl>

          <h4 className="stats__subtitle">{t("stats.top")}</h4>
          <ul className="stats__bars">
            {stats.topScenarios.map((row) => (
              <li key={row.scenario}>
                <span className="stats__bar-label">
                  <code>{row.scenario}</code> {stats.names[row.scenario] ?? ""}
                </span>
                <span className="stats__bar-value">
                  {row.turns} · {row.avgConfidence.toFixed(2)}
                </span>
                <span className="stats__bar" style={{ width: `${Math.max(6, (row.turns / (stats.topScenarios[0]?.turns ?? 1)) * 100)}%` }} />
              </li>
            ))}
          </ul>

          <h4 className="stats__subtitle">{t("stats.doubtful")}</h4>
          {stats.doubtful.length === 0 ? (
            <p className="muted">{t("stats.doubtfulEmpty")}</p>
          ) : (
            <ul className="stats__doubtful">
              {stats.doubtful.map((row) => (
                <li key={`${row.at}-${row.transcript}`}>
                  <span className="stats__quote">«{row.transcript}»</span>
                  <span className="stats__meta">
                    {row.scenario ? <code>{row.scenario}</code> : null}
                    {row.confidence !== null ? ` ${row.confidence.toFixed(2)}` : ""} ·{" "}
                    {t(ACTION_LABEL[row.action] ?? "stats.action.run")}
                    {row.error ? ` · ${row.error}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
