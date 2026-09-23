"use client";

import { useI18n } from "../lib/i18n";
import type { VoiceStatus } from "./types";

export function StatusLine({ status }: { status: VoiceStatus }) {
  const { t } = useI18n();
  return (
    <p className="status-line" role="status" aria-live="polite" style={{ margin: 0 }}>
      <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
      <span className="visually-hidden">{t("status.label")}: </span>
      {t(`status.${status}`)}
    </p>
  );
}
