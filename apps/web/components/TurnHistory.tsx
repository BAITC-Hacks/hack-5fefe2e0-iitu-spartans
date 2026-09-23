"use client";

import type { TurnTrace } from "@voice-router/core";
import { useI18n } from "../lib/i18n";

// Краткая сводка хода: выбранные сценарии, а если решения нет — действие политики,
// чтобы по истории было видно, где робот переспрашивал или отдавал разговор оператору.
function summary(trace: TurnTrace, actionLabel: string): string {
  const ids = trace.decision?.scenarios.map((s) => s.scenario_id) ?? [];
  return ids.length > 0 ? ids.join(" + ") : actionLabel;
}

interface TurnHistoryProps {
  traces: TurnTrace[];
  selected: number;
  onSelect: (index: number) => void;
}

/** История ходов: свежие сверху; щелчок открывает трассировку прошлого хода в панели. */
export function TurnHistory({ traces, selected, onSelect }: TurnHistoryProps) {
  const { t } = useI18n();
  if (traces.length === 0) return <p className="muted">{t("history.empty")}</p>;

  const indexed = traces.map((trace, index) => ({ trace, index })).reverse();
  return (
    <ol className="history">
      {indexed.map(({ trace, index }) => (
        <li key={index}>
          <button
            type="button"
            className="history__item"
            aria-current={index === selected}
            title={t("history.show", { n: trace.turn })}
            onClick={() => onSelect(index)}
          >
            <span className="history__turn">{trace.turn}</span>
            <span className="history__ids">{summary(trace, t(`action.${trace.action.kind}`))}</span>
            <span className="history__text">{trace.transcript}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
