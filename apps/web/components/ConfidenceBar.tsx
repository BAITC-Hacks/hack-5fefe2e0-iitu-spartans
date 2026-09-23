"use client";

import { CLARIFY_THRESHOLD, RUN_THRESHOLD } from "@voice-router/core";
import { useI18n } from "../lib/i18n";

// Цвет полосы повторяет пороги политики, чтобы супервизор сразу видел, почему робот запустил сценарий,
// переспросил или ушёл к оператору. Пороги берутся из ядра, а не дублируются числами.
function level(confidence: number): "high" | "mid" | "low" {
  if (confidence >= RUN_THRESHOLD) return "high";
  if (confidence >= CLARIFY_THRESHOLD) return "mid";
  return "low";
}

export function ConfidenceBar({ value }: { value: number }) {
  const { t } = useI18n();
  const clamped = Math.min(1, Math.max(0, value));
  const percent = Math.round(clamped * 100);
  const tone = level(clamped);
  return (
    <div className="confidence">
      <div
        className="confidence__track"
        role="meter"
        aria-label={t("trace.confidence")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={`confidence__fill${tone === "high" ? "" : ` confidence__fill--${tone}`}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="confidence__value">{clamped.toFixed(2)}</span>
    </div>
  );
}
