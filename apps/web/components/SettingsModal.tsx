"use client";

import { useI18n, type MessageKey } from "../lib/i18n";
import type { EngineId, EngineInfo } from "./compare-client";
import { Modal } from "./Modal";
import { RECOGNITION_LANGS, type RecognitionLang } from "./use-speech-recognition";

/**
 * Пульт разговора в одном окне: язык распознавания, озвучивание ответов, подсказки о возможностях браузера
 * и какие движки выбора сценария настроены на сервере. На главном экране остаются только микрофон и статус.
 */

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  lang: RecognitionLang;
  onLangChange: (lang: RecognitionLang) => void;
  listening: boolean;
  speakReplies: boolean;
  onSpeakRepliesChange: (value: boolean) => void;
  synthesisSupported: boolean | null;
  showNoKazakhVoice: boolean;
  engines: EngineInfo[];
}

const ENGINE_LABEL: Record<EngineId, MessageKey> = { openai: "engine.openai", gemini: "engine.gemini" };
const ENGINE_ENV: Record<EngineId, string> = { openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" };

export function SettingsModal(props: SettingsModalProps) {
  const { t } = useI18n();
  return (
    <Modal open={props.open} title={t("settings.title")} closeLabel={t("compare.close")} onClose={props.onClose}>
      <section className="settings-section">
        <h3 className="section__title">{t("settings.voice")}</h3>
        <div className="settings-row">
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
        </div>
        {props.synthesisSupported ? (
          <div className="settings-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={props.speakReplies}
                onChange={(event) => props.onSpeakRepliesChange(event.target.checked)}
              />
              {t("mic.speakReplies")}
            </label>
          </div>
        ) : null}
        {props.synthesisSupported === false ? <p className="hint">{t("mic.noSynthesis")}</p> : null}
        {props.showNoKazakhVoice ? <p className="hint">{t("mic.noKkVoice")}</p> : null}
      </section>

      <section className="settings-section">
        <h3 className="section__title">{t("settings.engines")}</h3>
        <ul className="engine-list">
          {props.engines.map((engine) => (
            <li key={engine.id} className={`engine-item engine-item--${engine.available ? "ready" : "missing"}`}>
              <span className="engine-item__dot" aria-hidden="true" />
              <span className="engine-item__name">{t(ENGINE_LABEL[engine.id])}</span>
              <span className="engine-item__state">
                {engine.available ? (
                  <>
                    <span className="engine-card__model">{engine.model}</span> {t("settings.ready")}
                  </>
                ) : (
                  t("compare.unavailable", { env: ENGINE_ENV[engine.id] })
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted compare-hint">{t("compare.hint")}</p>
      </section>
    </Modal>
  );
}
