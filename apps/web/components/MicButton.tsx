"use client";

import { useI18n } from "../lib/i18n";

interface MicButtonProps {
  listening: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function MicButton({ listening, disabled, onStart, onStop }: MicButtonProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="mic-button"
      aria-pressed={listening}
      disabled={disabled}
      onClick={listening ? onStop : onStart}
    >
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
        <path
          d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span>{listening ? t("mic.stop") : t("mic.start")}</span>
    </button>
  );
}
