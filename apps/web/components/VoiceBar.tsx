"use client";

import { useI18n } from "../lib/i18n";
import { MicButton } from "./MicButton";
import { StatusLine } from "./StatusLine";
import type { VoiceStatus } from "./types";

interface VoiceBarProps {
  status: VoiceStatus;
  recognitionSupported: boolean | null;
  listening: boolean;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
}

/** Голосовой канал на главном экране: микрофон и статус робота. Язык и озвучивание — в окне настроек. */
export function VoiceBar(props: VoiceBarProps) {
  const { t } = useI18n();
  return (
    <div className="voice-bar">
      <MicButton
        listening={props.listening}
        disabled={props.recognitionSupported !== true || (props.busy && !props.listening)}
        onStart={props.onStart}
        onStop={props.onStop}
      />
      <div className="voice-bar__controls">
        <StatusLine status={props.status} />
        <p className="voice-bar__hint">{t("mic.hint")}</p>
        {props.recognitionSupported === false ? <p className="hint">{t("mic.unsupported")}</p> : null}
      </div>
    </div>
  );
}
