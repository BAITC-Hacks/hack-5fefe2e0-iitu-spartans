"use client";

import { useI18n, type MessageKey } from "../lib/i18n";
import { CircleCheck, GitCompareArrows, LoaderCircle, RotateCcw, Cpu, Clock3, TriangleAlert } from "lucide-react";
import type { CompareResponse, EngineId, EngineResult } from "./compare-client";
import { Modal } from "./Modal";
import { ScenarioCard } from "./ScenarioCard";
import type { TurnFailure } from "./turn-client";

/**
 * Окно «Сравнить ChatGPT и Gemini»: две колонки — по одной на движок выбора сценария — с решением, обоснованием,
 * альтернативами и задержкой, и вердикт сверху: совпал ли основной сценарий. Окно только показывает результат
 * /api/compare; запрос делает родитель, чтобы состояние сравнения жило вместе с историей ходов.
 */

export type CompareState =
  | { status: "idle" }
  | { status: "loading"; utterance: string }
  | { status: "done"; data: CompareResponse }
  | { status: "error"; utterance: string; failure: TurnFailure };

interface CompareModalProps {
  open: boolean;
  state: CompareState;
  onClose: () => void;
  onRerun: () => void;
}

const ENGINE_LABEL: Record<EngineId, MessageKey> = { openai: "engine.openai", gemini: "engine.gemini" };
/** Переменная окружения, включающая движок: окно называет её, когда ключа нет, вместо пустой колонки. */
const ENGINE_ENV: Record<EngineId, string> = { openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" };

function engineErrorLabel(error: string): MessageKey {
  if (/IP address restriction/i.test(error)) return "compare.errorIp";
  if (/\b40[13]\b/.test(error)) return "compare.errorAccess";
  if (/\b429\b/.test(error)) return "compare.errorLimit";
  return "compare.errorProvider";
}

function EngineColumn({ engine, names }: { engine: EngineResult; names: Record<string, string> }) {
  const { t } = useI18n();
  const { decision } = engine;
  return (
    <section className={`engine-card engine-card--${engine.id}`} aria-label={t(ENGINE_LABEL[engine.id])}>
      <header className="engine-card__head">
        <span className="engine-card__name"><Cpu size={18} aria-hidden="true" />{t(ENGINE_LABEL[engine.id])}</span>
        {engine.model ? <span className="engine-card__model">{engine.model}</span> : null}
      </header>
      {!engine.available ? <p className="hint">{t("compare.unavailable", { env: ENGINE_ENV[engine.id] })}</p> : null}
      {engine.error ? (
        <div className="provider-error" role="alert">
          <TriangleAlert size={24} aria-hidden="true" />
          <strong>{t("compare.noDecision")}</strong>
          <p>{t(engineErrorLabel(engine.error))}</p>
          <details><summary>{t("compare.diagnostics")}</summary><pre>{engine.error}</pre></details>
        </div>
      ) : null}
      {decision ? (
        <>
          <ul className="scenario-list">
            {decision.scenarios.map((score) => (
              <ScenarioCard
                key={score.scenario_id}
                id={score.scenario_id}
                name={names[score.scenario_id]}
                confidence={score.confidence}
                reason={score.reason}
                primary
              />
            ))}
          </ul>
          {decision.alternatives.length > 0 ? (
            <ul className="scenario-list">
              {decision.alternatives.map((alt) => (
                <ScenarioCard
                  key={alt.scenario_id}
                  id={alt.scenario_id}
                  name={names[alt.scenario_id]}
                  confidence={alt.confidence}
                  reason={alt.reason}
                  primary={false}
                />
              ))}
            </ul>
          ) : (
            <p className="muted">{t("trace.noAlternatives")}</p>
          )}
          <p className="engine-card__latency">
            <Clock3 size={15} aria-hidden="true" />
            <b>{engine.latencyMs}</b> {t("compare.ms")} · {t("compare.attempts", { n: engine.attempts })} ·{" "}
            {t(`dialogLang.${decision.language}`)}
          </p>
        </>
      ) : engine.available && !engine.error ? (
        <p className="muted">{t("compare.noDecision")}</p>
      ) : null}
    </section>
  );
}

function failureText(t: (key: MessageKey, vars?: Record<string, string | number>) => string, failure: TurnFailure): string {
  switch (failure.kind) {
    case "http":
      return `${t("error.http", { status: failure.status })}${failure.detail ? ` — ${failure.detail}` : ""}`;
    case "network":
      return t("error.network");
    case "bad-response":
      return t("error.badResponse");
  }
}

export function CompareModal({ open, state, onClose, onRerun }: CompareModalProps) {
  const { t } = useI18n();
  const utterance = state.status === "done" ? state.data.utterance : state.status === "idle" ? "" : state.utterance;
  const verdict =
    state.status === "done"
      ? state.data.agree === true
        ? { className: "agree", text: t("compare.agree") }
        : state.data.agree === false
          ? { className: "disagree", text: t("compare.disagree") }
          : { className: "none", text: t("compare.incomplete") }
      : state.status === "loading"
        ? { className: "none", text: t("compare.loading") }
        : null;

  return (
    <Modal
      open={open}
      wide
      title={t("compare.title")}
      closeLabel={t("compare.close")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onRerun} disabled={state.status === "loading"}>
            <RotateCcw size={16} aria-hidden="true" />
            {t("compare.rerun")}
          </button>
          <button type="button" className="button" onClick={onClose}>
            {t("compare.close")}
          </button>
        </>
      }
    >
      {utterance ? (
        <p className="compare-utterance">
          <span className="meta-item__label">{t("compare.utterance")}</span>
          <span className="meta-item__value">{utterance}</span>
        </p>
      ) : null}
      {verdict ? (
        <p className={`compare-verdict compare-verdict--${verdict.className}`} aria-live="polite">
          {state.status === "loading" ? <LoaderCircle className="icon-spin" size={21} aria-hidden="true" /> : verdict.className === "agree" ? <CircleCheck size={21} aria-hidden="true" /> : <GitCompareArrows size={21} aria-hidden="true" />}
          {verdict.text}
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className="error-box" role="alert">
          {t("compare.error")}: {failureText(t, state.failure)}
        </p>
      ) : null}
      {state.status === "loading" ? (
        <div className="compare-grid compare-loading" aria-hidden="true">
          {["openai", "gemini"].map((engine) => <div className="engine-skeleton" key={engine}><span /><span /><span /></div>)}
        </div>
      ) : null}
      {state.status === "done" ? (
        <div className="compare-grid">
          {state.data.engines.map((engine) => (
            <EngineColumn key={engine.id} engine={engine} names={state.data.scenarioNames} />
          ))}
        </div>
      ) : null}
      <p className="muted compare-hint">{t("compare.hint")}</p>
    </Modal>
  );
}
