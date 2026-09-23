"use client";

import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai";
import { INITIAL_CLIENT_STATE, type ClientDialogState, type TurnTrace } from "@voice-router/core";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "../../components/AppHeader";
import { TracePanel } from "../../components/TracePanel";
import { postTurn } from "../../components/turn-client";
import { I18nProvider } from "../../lib/i18n";
import { liveConfig } from "../../lib/live/config";

/**
 * Страница /live: звонок роботу через Gemini Live API — один открытый поток к Google, звук в обе стороны,
 * перебивание, распознавание и голос на стороне модели. Выбор сценария при этом делает наш LLM-слой:
 * Gemini на каждую реплику вызывает инструмент route_utterance, мы отвечаем результатом POST /api/turn,
 * и модель произносит ровно этот текст. Панель справа — та же трассировка, что на главной странице.
 */

type Phase = "idle" | "connecting" | "live" | "error" | "closed";

const IN_RATE = 16_000;
const OUT_RATE = 24_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

/** Проигрыватель PCM 24 кГц: куски ставятся встык, при перебивании очередь обрывается. */
class PcmPlayer {
  private ctx = new AudioContext({ sampleRate: OUT_RATE });
  private playhead = 0;
  private sources = new Set<AudioBufferSourceNode>();

  push(base64: string) {
    const bytes = fromBase64(base64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buffer = this.ctx.createBuffer(1, samples.length, OUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = (samples[i] ?? 0) / 0x8000;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const startAt = Math.max(this.ctx.currentTime, this.playhead);
    source.start(startAt);
    this.playhead = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  interrupt() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // уже остановлен
      }
    }
    this.sources.clear();
    this.playhead = 0;
  }

  close() {
    this.interrupt();
    void this.ctx.close();
  }
}

export default function LivePage() {
  return (
    <I18nProvider>
      <LiveCall />
    </I18nProvider>
  );
}

function LiveCall() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [model, setModel] = useState("");
  const [youText, setYouText] = useState("");
  const [botText, setBotText] = useState("");
  const [trace, setTrace] = useState<TurnTrace | null>(null);
  const [turns, setTurns] = useState(0);

  const sessionRef = useRef<Session | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const micRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode } | null>(null);
  const stateRef = useRef<ClientDialogState>(INITIAL_CLIENT_STATE);

  useEffect(() => {
    fetch("/api/live/token")
      .then((r) => r.json() as Promise<{ available?: boolean; model?: string }>)
      .then((b) => {
        setAvailable(b.available === true);
        setModel(b.model ?? "");
      })
      .catch(() => setAvailable(false));
  }, []);

  const hangUp = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    const mic = micRef.current;
    if (mic) {
      mic.node.disconnect();
      for (const track of mic.stream.getTracks()) track.stop();
      void mic.ctx.close();
      micRef.current = null;
    }
    playerRef.current?.close();
    playerRef.current = null;
    setPhase("closed");
  }, []);

  useEffect(() => () => hangUp(), [hangUp]);

  /** Инструмент route_utterance: реплика уходит в наш LLM-слой, модель получает текст ответа и сценарий. */
  const route = useCallback(async (utterance: string) => {
    const result = await postTurn({ utterance, state: stateRef.current });
    if (!result.ok) return { reply: "Не расслышал, повторите, пожалуйста.", error: result.failure.kind };
    stateRef.current = result.data.state;
    setTrace(result.data.trace);
    setTurns((n) => n + 1);
    const primary = result.data.trace.decision?.scenarios[0];
    return {
      reply: result.data.reply.text,
      language: result.data.reply.language,
      scenario: primary?.scenario_id ?? null,
      confidence: primary?.confidence ?? null,
    };
  }, []);

  const onMessage = useCallback(
    (message: LiveServerMessage) => {
      const content = message.serverContent;
      if (content?.interrupted) playerRef.current?.interrupt();
      for (const part of content?.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) playerRef.current?.push(part.inlineData.data);
      }
      if (content?.inputTranscription?.text) setYouText((t) => `${t}${content.inputTranscription?.text ?? ""}`);
      if (content?.outputTranscription?.text) setBotText((t) => `${t}${content.outputTranscription?.text ?? ""}`);
      if (content?.turnComplete) {
        setYouText("");
        setBotText("");
      }
      const calls = message.toolCall?.functionCalls ?? [];
      if (calls.length > 0) {
        void (async () => {
          const functionResponses = [];
          for (const call of calls) {
            const utterance = String((call.args as { utterance?: unknown } | undefined)?.utterance ?? "").trim();
            const response = call.name === "route_utterance" && utterance ? await route(utterance) : { reply: "Не расслышал, повторите, пожалуйста." };
            functionResponses.push({ ...(call.id ? { id: call.id } : {}), ...(call.name ? { name: call.name } : {}), response });
          }
          sessionRef.current?.sendToolResponse({ functionResponses });
        })();
      }
    },
    [route],
  );

  const start = useCallback(async () => {
    setPhase("connecting");
    setDetail("");
    setYouText("");
    setBotText("");
    let token: string;
    let liveModel: string;
    try {
      const r = await fetch("/api/live/token", { method: "POST" });
      const body = (await r.json()) as { token?: string; model?: string; error?: string };
      if (!r.ok || !body.token || !body.model) throw new Error(body.error ?? `token ${r.status}`);
      token = body.token;
      liveModel = body.model;
    } catch (error) {
      setPhase("error");
      setDetail(error instanceof Error ? error.message : String(error));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
      playerRef.current = new PcmPlayer();
      const session = await ai.live.connect({
        model: liveModel,
        config: liveConfig(),
        callbacks: {
          onopen: () => setPhase("live"),
          onmessage: onMessage,
          onerror: (event) => {
            setPhase("error");
            setDetail(event.message || "ошибка соединения");
          },
          onclose: (event) => {
            setPhase((current) => (current === "error" ? current : "closed"));
            if (event.reason) setDetail(event.reason);
          },
        },
      });
      sessionRef.current = session;

      // Микрофон → PCM16 16 кГц → поток в сессию; выход процессора заглушён, чтобы микрофон не звучал в колонках.
      const ctx = new AudioContext({ sampleRate: IN_RATE });
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) pcm[i] = Math.max(-1, Math.min(1, input[i] ?? 0)) * 0x7fff;
        sessionRef.current?.sendRealtimeInput({ audio: { data: toBase64(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${IN_RATE}` } });
      };
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      micRef.current = { ctx, stream, node };
    } catch (error) {
      hangUp();
      setPhase("error");
      setDetail(error instanceof Error ? error.message : String(error));
    }
  }, [hangUp, onMessage]);

  const phaseLabel: Record<Phase, string> = {
    idle: "Готов к звонку",
    connecting: "Соединяю…",
    live: "На линии — говорите",
    error: "Ошибка",
    closed: "Звонок завершён",
  };

  return (
    <>
      <AppHeader />
      <main className="app-main">
        <section className="card" aria-labelledby="live-title">
          <div className="card__header">
            <h2 id="live-title" className="card__title">
              Звонок через Gemini Live
            </h2>
            <div className="card__actions">
              <Link href="/" className="button button--ghost button--small">
                Обычный звонок
              </Link>
              {phase === "live" || phase === "connecting" ? (
                <button type="button" className="button button--small" onClick={hangUp}>
                  Завершить
                </button>
              ) : (
                <button type="button" className="call-start" onClick={() => void start()} disabled={available !== true}>
                  Позвонить роботу
                </button>
              )}
            </div>
          </div>
          <div className="voice-bar">
            <div className="voice-bar__controls">
              <p className="status-line">
                <span className={`status-dot${phase === "live" ? " status-dot--listening" : phase === "connecting" ? " status-dot--thinking" : ""}`} />
                {phaseLabel[phase]}
              </p>
              <p className="voice-bar__hint">
                Один открытый поток к Google: речь уходит сразу, робота можно перебить. Сценарий выбирает наш LLM-слой через
                инструмент — трассировка справа та же, что в обычном звонке. Модель: {model || "—"}.
              </p>
              {available === false ? <p className="hint">На сервере нет GEMINI_API_KEY — страница недоступна, обычный звонок работает.</p> : null}
              {detail ? (
                <p className="error-box" role="alert">
                  {detail}
                </p>
              ) : null}
            </div>
          </div>
          <ul className="messages" aria-live="polite">
            {youText ? <li className="bubble bubble--client">{youText}</li> : null}
            {botText ? <li className="bubble bubble--bot">{botText}</li> : null}
            {!youText && !botText ? <li className="messages__empty">Нажмите «Позвонить роботу» и говорите на русском или казахском.</li> : null}
          </ul>
        </section>
        <aside className="card" aria-labelledby="live-trace-title">
          <div className="card__header">
            <h2 id="live-trace-title" className="card__title">
              Панель супервизора
            </h2>
            {turns > 0 ? <span className="badge badge--turn">Ход {turns}</span> : null}
          </div>
          {trace ? <TracePanel trace={trace} /> : <p className="muted">Трассировка появится после первой реплики.</p>}
        </aside>
      </main>
    </>
  );
}
