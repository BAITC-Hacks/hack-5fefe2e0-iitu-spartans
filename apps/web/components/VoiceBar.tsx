"use client";

import { useI18n } from "../lib/i18n";
import { MicButton } from "./MicButton";
import { StatusLine } from "./StatusLine";
import type { VoiceStatus } from "./types";
import { RECOGNITION_LANGS, type RecognitionLang } from "./use-speech-recognition";

interface VoiceBarProps {
  status: VoiceStatus;
  recognitionSupported: boolean | null;
  synthesisSupported: boolean | null;
  listening: boolean;
  busy: boolean;
  lang: RecognitionLang;
  onLangChange: (lang: RecognitionLang) => void;
  speakReplies: boolean;
  onSpeakRepliesChange: (value: boolean) => void;
  showNoKazakhVoice: boolean;
  onStart: () => void;
  onStop: () => void;
}

/** Голосовой канал: микрофон, статус робота, язык распознавания и озвучивание ответов. */
export function VoiceBar(props: VoiceBarProps) {
  const { t } = useI18n();
  const { recognitionSupported, synthesisSupported } = props;
  return (
    <div className="voice-bar">
      <MicButton
        listening={props.listening}
        disabled={recognitionSupported !== true || (props.busy && !props.listening)}
        onStart={props.onStart}
        onStop={props.onStop}
      />
      <div className="voice-bar__controls">
        <StatusLine status={props.status} />
        <div className="field-row">
          <label htmlFor="recognition-lang">{t("mic.recognitionLanguage")}</label>
          <select
            id="recognition-lang"
            className="select"
            value={props.lang}
            disabled={props.listening}
            onChange={(event) => props.onLangChange(event.target.value as RecognitionLang)}
          >
            {RECOGNITION_LANGS.map((code) => (
              <option key={code} value={code}>
                {t(`mic.recog.${code}`)}
              </option>
            ))}
          </select>
          {synthesisSupported ? (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={props.speakReplies}
                onChange={(event) => props.onSpeakRepliesChange(event.target.checked)}
              />
              {t("mic.speakReplies")}
            </label>
          ) : null}
        </div>
        {recognitionSupported === false ? <p className="hint">{t("mic.unsupported")}</p> : null}
        {synthesisSupported === false ? <p className="hint">{t("mic.noSynthesis")}</p> : null}
        {props.showNoKazakhVoice ? <p className="hint">{t("mic.noKkVoice")}</p> : null}
      </div>
    </div>
  );
}
