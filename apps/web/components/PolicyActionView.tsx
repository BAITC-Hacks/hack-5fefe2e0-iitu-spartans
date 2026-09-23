"use client";

import type { PolicyAction } from "@voice-router/core";
import type { ReactNode } from "react";
import { useI18n } from "../lib/i18n";

function ScenarioChips({ ids, names }: { ids: string[]; names: Record<string, string> }) {
  return (
    <ul className="chip-list">
      {ids.map((id) => (
        <li key={id} className="chip">
          {names[id] && names[id] !== id ? `${id} · ${names[id]}` : id}
        </li>
      ))}
    </ul>
  );
}

/** Действие политики крупной плашкой: это главный ответ на вопрос «что робот решил сделать». */
export function PolicyActionView({ action, names }: { action: PolicyAction; names: Record<string, string> }) {
  const { t } = useI18n();

  let detail: ReactNode;
  switch (action.kind) {
    case "run":
      detail = (
        <>
          <span>{t("action.queue")}:</span>
          <ScenarioChips ids={action.queue} names={names} />
        </>
      );
      break;
    case "clarify":
      detail = (
        <>
          <span>{t("action.options")}:</span>
          <ScenarioChips ids={action.options} names={names} />
        </>
      );
      break;
    case "continue":
      detail = (
        <>
          <span>{t("action.scenario")}:</span>
          <ScenarioChips ids={[action.scenarioId]} names={names} />
        </>
      );
      break;
    case "handoff":
      detail = (
        <span>
          {t("action.reason")}: {t(`handoff.${action.reason}`)}
        </span>
      );
      break;
  }

  return (
    <div className={`policy policy--${action.kind}`}>
      <span className="policy__label">{t(`action.${action.kind}`)}</span>
      <div className="policy__detail">{detail}</div>
    </div>
  );
}
