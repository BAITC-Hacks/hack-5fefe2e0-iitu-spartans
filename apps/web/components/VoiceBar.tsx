"use client";

import { useI18n, type MessageKey } from "../lib/i18n";
import { MicButton } from "./MicButton";
import { StatusLine } from "./StatusLine";
import type { TurnVoice, VoiceStatus } from "./types";

interface VoiceBarProps {
  status: VoiceStatus;
  /** Можно ли записывать: серверный путь — есть MediaRecorder, браузерный — есть распознавание браузера. */
  micAvailable: boolean | null;
  listening: boolean;
  busy: boolean;
  /** Подсказка текущей фазы (запись, распознавание); иначе — общая. */
  hint?: MessageKey;
  /** Какой путь распознавания и озвучки сработает сейчас; видно, сервер это или запасной путь браузера. */
  channel: TurnVoice;
  onStart: () => void;
  onStop: () => void;
}

/** Голосовой канал на главном экране: микрофон и статус робота. Язык и озвучивание — в окне настроек. */
export function VoiceBar(props: VoiceBarProps) {
  const { t } = useI18n();
  const pathLabel = (path: TurnVoice["stt"]) =>
    path ? t(path === "server" ? "voice.path.server" : "voice.path.browser") : "—";
  return (
    <div className="voice-bar">
      <MicButton
        listening={props.listening}
        disabled={props.micAvailable !== true || (props.busy && !props.listening)}
        onStart={props.onStart}
        onStop={props.onStop}
      />
      <div className="voice-bar__controls">
        <StatusLine status={props.status} />
        <p className="voice-bar__hint">{t(props.hint ?? "mic.hint")}</p>
        <p className="muted">{t("voice.channel", { stt: pathLabel(props.channel.stt), tts: pathLabel(props.channel.tts) })}</p>
        {props.micAvailable === false ? <p className="hint">{t("mic.unsupported")}</p> : null}
      </div>
    </div>
  );
}
