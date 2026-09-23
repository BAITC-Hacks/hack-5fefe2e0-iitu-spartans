"use client";

import type { TurnTrace } from "@voice-router/core";
import { useI18n } from "../lib/i18n";

// Краткая сводка хода: выбранные сценарии, а если решения нет — действие политики,
// чтобы по истории было видно, где робот переспрашивал или отдавал разговор оператору.
// Идентификаторы набраны моноширинным шрифтом, а подпись действия — обычным: это текст, а не код.
function Summary({ trace, actionLabel }: { trace: TurnTrace; actionLabel: string }) {
  const ids = trace.decision?.scenarios.map((s) => s.scenario_id) ?? [];
  return ids.length > 0 ? (
    <span className="history__ids">{ids.join(" + ")}</span>
  ) : (
    <span className="history__action">{actionLabel}</span>
  );
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
            <Summary trace={trace} actionLabel={t(`action.${trace.action.kind}`)} />
            <span className="history__text">{trace.transcript}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
