"use client";

import type { TurnTrace } from "@voice-router/core";
import type { ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { LatencyTable } from "./LatencyTable";
import { PolicyActionView } from "./PolicyActionView";
import { ScenarioCard } from "./ScenarioCard";
import { SlotsTable } from "./SlotsTable";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3 className="section__title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Трассировка одного хода для супервизора (ТЗ: сценарий, обоснование, альтернативы, время по этапам).
 * decision бывает null — ошибка маршрутизатора или демо без модели; действие и задержки есть всегда.
 */
export function TracePanel({ trace }: { trace: TurnTrace }) {
  const { t } = useI18n();
  const { decision, scenarioNames } = trace;

  return (
    <div>
      <div className="trace-meta">
        <div className="meta-item">
          <span className="meta-item__label">{t("trace.transcript")}</span>
          <span className="meta-item__value">{trace.transcript}</span>
        </div>
        <div className="meta-item">
          <span className="meta-item__label">{t("trace.language")}</span>
          <span className="meta-item__value">{t(`dialogLang.${trace.language}`)}</span>
        </div>
        <div className="meta-item">
          <span className="meta-item__label">{t("trace.source")}</span>
          <span className={`badge badge--source-${trace.source}`}>{t(`source.${trace.source}`)}</span>
        </div>
      </div>

      {trace.error ? (
        <Section title={t("trace.error")}>
          <p className="error-box" role="alert">
            {trace.error}
          </p>
        </Section>
      ) : null}

      <Section title={t("trace.action")}>
        <PolicyActionView action={trace.action} names={scenarioNames} />
      </Section>

      {decision ? (
        <>
          <Section title={t("trace.scenarios")}>
            {decision.is_continuation ? <p className="muted">{t("trace.continuation")}</p> : null}
            <ul className="scenario-list">
              {decision.scenarios.map((score) => (
                <ScenarioCard
                  key={score.scenario_id}
                  id={score.scenario_id}
                  name={scenarioNames[score.scenario_id]}
                  confidence={score.confidence}
                  reason={score.reason}
                  primary
                />
              ))}
            </ul>
          </Section>

          <Section title={t("trace.alternatives")}>
            {decision.alternatives.length === 0 ? (
              <p className="muted">{t("trace.noAlternatives")}</p>
            ) : (
              <ul className="scenario-list">
                {decision.alternatives.map((alt) => (
                  <ScenarioCard
                    key={alt.scenario_id}
                    id={alt.scenario_id}
                    name={scenarioNames[alt.scenario_id]}
                    confidence={alt.confidence}
                    reason={alt.reason}
                    primary={false}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section title={t("trace.slots")}>
            <SlotsTable slots={decision.slots} />
          </Section>
        </>
      ) : (
        <Section title={t("trace.scenarios")}>
          <p className="muted">{t("trace.noDecision")}</p>
        </Section>
      )}

      <Section title={t("trace.latency")}>
        <LatencyTable latency={trace.latencyMs} />
      </Section>
    </div>
  );
}
