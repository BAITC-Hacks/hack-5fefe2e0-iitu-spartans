"use client";

import type { TurnTrace } from "@voice-router/core";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, CircleCheck, CircleHelp, Headphones, Workflow, Clock3, Timer, Languages, FileSearch, TriangleAlert, GitCompareArrows } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { LatencyTable } from "./LatencyTable";
import { PolicyActionView } from "./PolicyActionView";
import { ScenarioCard } from "./ScenarioCard";
import { SlotsTable } from "./SlotsTable";
import { Modal } from "./Modal";

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
function TraceDetails({ trace }: { trace: TurnTrace }) {
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

/** The first screen answers what, why and how fast. Full evidence remains one
 * click away and never opens automatically over an ongoing conversation. */
export function TracePanel({ trace }: { trace: TurnTrace }) {
  const { t } = useI18n();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { decision, scenarioNames, action, latencyMs } = trace;
  const ActionIcon = action.kind === "handoff" ? Headphones : action.kind === "clarify" ? CircleHelp : action.kind === "continue" ? Workflow : CircleCheck;

  return (
    <div className="result-panel">
      <div className={`result-status result-status--${action.kind}`}>
        <span className="result-status__icon"><ActionIcon size={21} aria-hidden="true" /></span>
        <div><span className="result-status__eyebrow">{t("trace.action")}</span><strong>{t(`action.${action.kind}`)}</strong></div>
        <span className="result-language"><Languages size={14} aria-hidden="true" />{t(`dialogLang.${trace.language}`)}</span>
      </div>
      <blockquote className="result-transcript">{trace.transcript}</blockquote>
      <div className="result-source"><span>{t("trace.source")}</span><span className={`badge badge--source-${trace.source}`}>{t(`source.${trace.source}`)}</span></div>
      {trace.error ? <p className="error-box" role="alert"><TriangleAlert size={16} aria-hidden="true" /> {trace.error}</p> : null}
      {decision ? (
        <ul className="scenario-list result-scenarios">
          {decision.scenarios.map((score) => (
            <ScenarioCard key={score.scenario_id} id={score.scenario_id} name={scenarioNames[score.scenario_id]}
              confidence={score.confidence} reason={score.reason} primary />
          ))}
        </ul>
      ) : <p className="muted">{t("trace.noDecision")}</p>}
      <div className="result-timing" aria-label={t("trace.latency")}>
        <div><Clock3 size={16} aria-hidden="true" /><span>{t("latency.stt")}</span><strong>{latencyMs.stt === undefined ? "—" : Math.round(latencyMs.stt)}<small>{latencyMs.stt === undefined ? "" : t("latency.ms")}</small></strong></div>
        <div><Workflow size={16} aria-hidden="true" /><span>{t("latency.router")}</span><strong>{Math.round(latencyMs.router)}<small>{t("latency.ms")}</small></strong></div>
        <div><Timer size={16} aria-hidden="true" /><span>{t("latency.total")}</span><strong>{Math.round(latencyMs.total)}<small>{t("latency.ms")}</small></strong></div>
      </div>
      <button type="button" className="result-details-button" onClick={() => setDetailsOpen(true)}>
        <FileSearch size={18} aria-hidden="true" /><span>{t("trace.details")}</span><ArrowUpRight size={17} aria-hidden="true" />
      </button>
      <section className="result-alternatives">
        <h3><GitCompareArrows size={15} aria-hidden="true" />{t("trace.alternatives")}</h3>
        {decision?.alternatives.length ? (
          <ul className="scenario-list">
            {decision.alternatives.map((alt) => (
              <ScenarioCard key={alt.scenario_id} id={alt.scenario_id} name={scenarioNames[alt.scenario_id]}
                confidence={alt.confidence} reason={alt.reason} primary={false} />
            ))}
          </ul>
        ) : <p className="muted">{decision ? t("trace.noAlternatives") : t("trace.noDecision")}</p>}
      </section>
      <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)} title={`${t("trace.details")} · ${t("trace.turn", { n: trace.turn })}`} closeLabel={t("compare.close")}>
        <TraceDetails trace={trace} />
      </Modal>
    </div>
  );
}
