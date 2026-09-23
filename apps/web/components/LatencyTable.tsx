"use client";

import type { TurnLatency } from "@voice-router/core";
import { useI18n, type MessageKey } from "../lib/i18n";

const STAGES: { key: keyof TurnLatency; label: MessageKey }[] = [
  { key: "stt", label: "latency.stt" },
  { key: "router", label: "latency.router" },
  { key: "response", label: "latency.response" },
];

function formatMs(value: number | undefined): string {
  // Распознавание речи отсутствует у текстовых реплик — прочерк честнее нуля.
  return value === undefined ? "—" : String(Math.round(value));
}

export function LatencyTable({ latency }: { latency: TurnLatency }) {
  const { t } = useI18n();
  return (
    <table className="table">
      <thead>
        <tr>
          <th scope="col">{t("latency.stage")}</th>
          <th scope="col" className="num">
            {t("latency.ms")}
          </th>
        </tr>
      </thead>
      <tbody>
        {STAGES.map((stage) => (
          <tr key={stage.key}>
            <td>{t(stage.label)}</td>
            <td className="num">{formatMs(latency[stage.key])}</td>
          </tr>
        ))}
        <tr className="total">
          <td>{t("latency.total")}</td>
          <td className="num">{formatMs(latency.total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
