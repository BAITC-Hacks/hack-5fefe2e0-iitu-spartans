"use client";

import { useI18n } from "../lib/i18n";
import { ConfidenceBar } from "./ConfidenceBar";

interface ScenarioCardProps {
  id: string;
  name: string | undefined;
  confidence: number;
  reason: string | undefined;
  primary: boolean;
}

export function ScenarioCard({ id, name, confidence, reason, primary }: ScenarioCardProps) {
  const { t } = useI18n();
  return (
    <li className={`scenario${primary ? " scenario--primary" : ""}`}>
      <div className="scenario__head">
        <span className="scenario__id">{id}</span>
        {name && name !== id ? <span className="scenario__name">{name}</span> : null}
      </div>
      <ConfidenceBar value={confidence} />
      {reason ? (
        <p className="scenario__reason">
          <span className="visually-hidden">{t("trace.reason")}: </span>
          {reason}
        </p>
      ) : null}
    </li>
  );
}
