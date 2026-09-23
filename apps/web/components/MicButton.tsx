"use client";

import { useI18n } from "../lib/i18n";
import { Mic, Square } from "lucide-react";

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
      {listening ? <Square size={26} aria-hidden="true" /> : <Mic size={26} aria-hidden="true" />}
      <span>{listening ? t("mic.stop") : t("mic.start")}</span>
    </button>
  );
}
