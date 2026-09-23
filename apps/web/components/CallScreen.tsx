"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useI18n, type MessageKey } from "../lib/i18n";

/**
 * Экран звонка: разговор с роботом как по телефону — без кнопки на каждую реплику.
 *
 * Компонент только показывает состояние звонка; запись, распознавание и ответ робота ведёт родитель.
 * Фаза видна трижды — анимацией шара, цветом и подписью, — чтобы состояние читалось и без анимации
 * (prefers-reduced-motion) и было доступно экранному диктору.
 */

export type CallPhase = "connecting" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking";

export interface CallScreenProps {
  phase: CallPhase;
  /** Громкость микрофона 0..1, обновляется примерно 10 раз в секунду. */
  level: number;
  /** Date.now() в момент начала звонка. */
  startedAt: number;
  clientText?: string;
  botText?: string;
  scenario?: { id: string; name: string; confidence: number };
  onHangUp: () => void;
}

const PHASE_LABEL: Record<CallPhase, MessageKey> = {
  connecting: "call.phase.connecting",
  listening: "call.phase.listening",
  hearing: "call.phase.hearing",
  transcribing: "call.phase.transcribing",
  thinking: "call.phase.thinking",
  speaking: "call.phase.speaking",
};

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Таймер тикает раз в секунду сам: родитель не должен перерисовываться ради часов. */
function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now - startedAt;
}

function PhoneIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function HangUpIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 9.5c-2.9 0-5.6.6-7.9 1.8a1.2 1.2 0 0 0-.66 1.07v2.4a1 1 0 0 0 1.3.95l3.05-.98a1 1 0 0 0 .69-.95v-1.72A13.4 13.4 0 0 1 12 11.6c1.25 0 2.45.17 3.52.47v1.72a1 1 0 0 0 .69.95l3.05.98a1 1 0 0 0 1.3-.95v-2.4a1.2 1.2 0 0 0-.66-1.07A17.6 17.6 0 0 0 12 9.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Содержимое центра шара по фазе: у каждой фазы свой знак, а не только своя анимация. */
function OrbCore({ phase }: { phase: CallPhase }) {
  if (phase === "connecting") return <PhoneIcon size={40} />;
  if (phase === "thinking") {
    return (
      <span className="call-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    );
  }
  if (phase === "speaking") {
    return (
      <span className="call-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
    );
  }
  return <MicIcon />;
}

export function CallScreen({ phase, level, startedAt, clientText, botText, scenario, onHangUp }: CallScreenProps) {
  const { t } = useI18n();
  const duration = formatDuration(useElapsed(startedAt));
  // Громкость приходит от анализатора микрофона; вне 0..1 кольца разлетались бы за пределы карточки.
  const safeLevel = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const orbStyle = { "--call-level": safeLevel.toFixed(3) } as CSSProperties;

  return (
    <section className="call-screen" aria-labelledby="call-title">
      <header className="call-screen__top">
        <div className="call-screen__heading">
          <h3 id="call-title" className="call-screen__title">
            {t("call.title")}
          </h3>
          <span className="call-lang-pill" title={t("call.langAuto")}>
            <span aria-hidden="true">ru · kk</span>
            <span className="visually-hidden">{t("call.langAuto")}</span>
          </span>
        </div>
        <span className="call-timer" role="timer" aria-label={`${t("call.timer")}: ${duration}`}>
          {duration}
        </span>
      </header>

      <div className="call-screen__stage">
        <div className={`call-orb call-orb--${phase}`} style={orbStyle}>
          <span className="call-orb__ring call-orb__ring--3" aria-hidden="true" />
          <span className="call-orb__ring call-orb__ring--2" aria-hidden="true" />
          <span className="call-orb__ring call-orb__ring--1" aria-hidden="true" />
          <span className="call-orb__arc" aria-hidden="true" />
          <span className="call-orb__core">
            <OrbCore phase={phase} />
          </span>
        </div>
        <p className="call-phase" aria-live="polite">
          {t(PHASE_LABEL[phase])}
        </p>
      </div>

      <div className="call-captions">
        {clientText ? (
          <p className="call-caption call-caption--client">
            <span className="call-caption__who">{t("call.you")}</span>
            <span className="call-caption__text">{clientText}</span>
          </p>
        ) : null}
        {botText ? (
          <p className="call-caption call-caption--bot">
            <span className="call-caption__who">{t("call.robot")}</span>
            <span className="call-caption__text">{botText}</span>
          </p>
        ) : null}
        {scenario ? (
          <p className="call-scenario">
            <span className="call-scenario__label">{t("call.scenario")}</span>
            <span className="call-scenario__value">
              <b>{scenario.id}</b> · {scenario.name} · {scenario.confidence.toFixed(2)}
            </span>
          </p>
        ) : null}
      </div>

      <div className="call-screen__bottom">
        <button type="button" className="call-hangup" onClick={onHangUp} aria-label={t("call.hangUp")}>
          <HangUpIcon />
        </button>
        <span className="call-hangup__label" aria-hidden="true">
          {t("call.hangUp")}
        </span>
      </div>
    </section>
  );
}

/** Кнопка начала звонка рядом с голосовой панелью. */
export function CallStartButton({ onStart, disabled }: { onStart: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <button type="button" className="call-start" onClick={onStart} disabled={disabled}>
      <span className="call-start__icon">
        <PhoneIcon />
      </span>
      {t("call.start")}
    </button>
  );
}
