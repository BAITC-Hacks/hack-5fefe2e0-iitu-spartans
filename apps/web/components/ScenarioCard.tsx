"use client";

import { useI18n } from "../lib/i18n";
import { ConfidenceBar } from "./ConfidenceBar";
import { CornerDownRight, ShieldCheck, GitBranch } from "lucide-react";

interface ScenarioCardProps {
  id: string;
  name: string | undefined;
  confidence: number;
  reason: string | undefined;
  primary: boolean;
}

export function ScenarioCard({ id, name, confidence, reason, primary }: ScenarioCardProps) {
  const { t } = useI18n();
  const displayName = id === "SYS_UNCLEAR" ? t("system.unclear") : id === "SYS_OUT_OF_SCOPE" ? t("system.outOfScope") : id === "SYS_GOODBYE" ? t("system.goodbye") : name;
  return (
    <li className={`scenario${primary ? " scenario--primary" : ""}`}>
      <div className="scenario__head">
        {primary ? <ShieldCheck size={17} className="scenario__icon" aria-hidden="true" /> : <GitBranch size={16} className="scenario__icon" aria-hidden="true" />}
        <span className="scenario__id">{id}</span>
        {displayName && displayName !== id ? <span className="scenario__name">{displayName}</span> : null}
      </div>
      <ConfidenceBar value={confidence} />
      {reason ? (
        <p className="scenario__reason">
          <CornerDownRight size={14} aria-hidden="true" />
          <span className="visually-hidden">{t("trace.reason")}: </span>
          {reason}
        </p>
      ) : null}
    </li>
  );
}
