"use client";

import { useRef } from "react";
import { useI18n } from "../lib/i18n";

/** Удержание дольше этого — «нажал, говорю, отпустил»; короткое нажатие включает запись до второго нажатия. */
const HOLD_MS = 350;

interface MicButtonProps {
  listening: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function MicButton({ listening, disabled, onStart, onStop }: MicButtonProps) {
  const { t } = useI18n();
  // Время нажатия, если именно это нажатие начало запись; null — нажатие останавливало запись.
  const pressRef = useRef<number | null>(null);
  return (
    <button
      type="button"
      className="mic-button"
      aria-pressed={listening}
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (listening) {
          pressRef.current = null;
          onStop();
        } else {
          pressRef.current = performance.now();
          onStart();
        }
      }}
      onPointerUp={() => {
        const pressedAt = pressRef.current;
        pressRef.current = null;
        if (pressedAt !== null && performance.now() - pressedAt >= HOLD_MS) onStop();
      }}
      onClick={(event) => {
        // Мышь и касание обработаны в pointer-событиях; клавиатура (Enter, пробел) даёт click с detail 0.
        if (event.detail === 0) (listening ? onStop : onStart)();
      }}
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
