"use client";

import type { Language } from "@voice-router/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { MIC_CONSTRAINTS, pickRecorderMime } from "./audio-recording";
import type { CallPhase } from "./CallScreen";

/**
 * Режим звонка: разговор без кнопок, как по телефону. Микрофон открыт весь звонок; конец фразы определяется
 * по тишине, запись уходит на серверное распознавание (ru и kk сразу), ответ робота звучит голосом сервера,
 * после ответа робот снова слушает. Клиент может перебить робота: голос замолкает сразу, а его речь уже пишется.
 *
 * Выбор сценария остаётся за LLM-слоем на сервере: звонок меняет только канал, а не то, кто принимает решение.
 */

export interface CallReply {
  text: string;
  language: Language;
}

interface Options {
  onUtterance: (text: string, sttMs: number) => Promise<CallReply | null>;
  onError: (code: string) => void;
  /** Первый звук ответа: миллисекунды от готового текста ответа до начала воспроизведения (трассировка). */
  onFirstAudio?: (ms: number) => void;
}

// Порог речи считается от шума зала, измеренного в начале звонка: константа не работает на хакатоне и в тихом офисе.
const FRAME_MS = 50;
const CALIBRATION_MS = 600;
const MIN_THRESHOLD = 0.012;
const NOISE_FACTOR = 2.5;
/** Столько тишины после речи — конец фразы. Меньше — робот перебивает клиента на паузе. */
const SILENCE_MS = 800;
/** Короче — щелчок или кашель, не реплика. */
const MIN_SPEECH_MS = 250;
const MAX_UTTERANCE_MS = 12_000;
/** Долго молчит — запись начинается заново, чтобы не отправлять на распознавание минуту тишины. */
const IDLE_RESTART_MS = 15_000;
/** Перебить робота можно, проговорив поверх него столько времени; порог выше, чтобы эхо своего голоса не сбивало. */
const BARGE_IN_MS = 300;
const BARGE_FACTOR = 1.8;

function rms(buffer: Float32Array): number {
  let sum = 0;
  for (const v of buffer) sum += v * v;
  return Math.sqrt(sum / buffer.length);
}

interface Recording {
  recorder: MediaRecorder;
  chunks: Blob[];
}

interface Callbacks {
  phase: (phase: CallPhase) => void;
  level: (level: number) => void;
  handlers: () => Options;
}

/** Движок одного звонка вне React: таймер кадров не должен зависеть от перерисовок. */
class CallEngine {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private buffer: Float32Array<ArrayBuffer>;
  private timer: ReturnType<typeof setInterval>;
  private mime = pickRecorderMime();
  private mode: "calibrating" | "listening" | "busy" | "speaking" = "calibrating";
  private noise: number[] = [];
  private threshold = MIN_THRESHOLD;
  private startedAt = performance.now();
  private listenStart = 0;
  private speechStart: number | null = null;
  private lastVoice = 0;
  private bargeStart: number | null = null;
  private recording: Recording | null = null;
  private audio: HTMLAudioElement | null = null;
  private closed = false;

  constructor(
    private stream: MediaStream,
    private cb: Callbacks,
  ) {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.ctx.createMediaStreamSource(stream).connect(this.analyser);
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.timer = setInterval(() => this.tick(), FRAME_MS);
    cb.phase("connecting");
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.discardRecording();
    this.stopSpeech();
    for (const track of this.stream.getTracks()) track.stop();
    void this.ctx.close();
    this.cb.level(0);
  }

  private tick() {
    this.analyser.getFloatTimeDomainData(this.buffer);
    const value = rms(this.buffer);
    const now = performance.now();
    this.cb.level(Math.min(1, value / (this.threshold * 4)));

    if (this.mode === "calibrating") {
      this.noise.push(value);
      if (now - this.startedAt >= CALIBRATION_MS) {
        const sorted = [...this.noise].sort((a, b) => a - b);
        this.threshold = Math.max(MIN_THRESHOLD, (sorted[Math.floor(sorted.length / 2)] ?? 0) * NOISE_FACTOR);
        this.listen();
      }
      return;
    }

    if (this.mode === "speaking") {
      if (value > this.threshold * BARGE_FACTOR) {
        this.bargeStart ??= now;
        if (now - this.bargeStart >= BARGE_IN_MS) this.bargeIn(now);
      } else {
        this.bargeStart = null;
      }
      return;
    }

    if (this.mode !== "listening") return;
    if (value > this.threshold) {
      this.speechStart ??= now;
      this.lastVoice = now;
    }
    const spoke = this.speechStart !== null && this.lastVoice - this.speechStart >= MIN_SPEECH_MS;
    if (spoke) this.cb.phase("hearing");
    if (spoke && (now - this.lastVoice >= SILENCE_MS || now - (this.speechStart ?? now) >= MAX_UTTERANCE_MS)) {
      void this.finishPhrase();
    } else if (!spoke && this.speechStart !== null && now - this.lastVoice > SILENCE_MS) {
      this.speechStart = null; // короткий шум без продолжения — не начало реплики
    } else if (!spoke && now - this.listenStart >= IDLE_RESTART_MS) {
      this.discardRecording();
      this.startRecording();
      this.listenStart = now;
    }
  }

  private listen() {
    if (this.closed) return;
    this.discardRecording();
    this.startRecording();
    this.mode = "listening";
    this.speechStart = null;
    this.listenStart = performance.now();
    this.cb.phase("listening");
  }

  /** Клиент заговорил поверх робота: голос замолкает сразу, запись с начала его речи уже идёт. */
  private bargeIn(now: number) {
    this.stopSpeech();
    this.mode = "listening";
    this.speechStart = this.bargeStart;
    this.lastVoice = now;
    this.listenStart = now;
    this.bargeStart = null;
    this.cb.phase("hearing");
  }

  private async finishPhrase() {
    this.mode = "busy";
    const speechEnd = this.lastVoice;
    this.cb.phase("transcribing");
    const audio = await this.stopRecording();
    if (this.closed) return;

    const form = new FormData();
    form.append("audio", audio, "speech");
    const response = await fetch("/api/stt", { method: "POST", body: form }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { text?: string; error?: string } | null;
    if (this.closed) return;
    if (!response?.ok || !body?.text) {
      // Тишина или шум — просто слушаем дальше; настоящую ошибку показываем.
      if (body?.error !== "empty") this.cb.handlers().onError(body?.error ?? "network");
      this.listen();
      return;
    }

    this.cb.phase("thinking");
    const reply = await this.cb.handlers().onUtterance(body.text, Math.round(performance.now() - speechEnd));
    if (this.closed) return;
    if (reply) this.speak(reply);
    else this.listen();
  }

  private speak(reply: CallReply) {
    this.mode = "speaking";
    this.bargeStart = null;
    this.cb.phase("speaking");
    // Запись идёт и во время ответа: если клиент перебьёт, начало его фразы не потеряется.
    this.discardRecording();
    this.startRecording();
    const lang = reply.language === "kk" ? "kk" : "ru";
    const requested = performance.now();
    const audio = new Audio(`/api/tts?lang=${lang}&text=${encodeURIComponent(reply.text)}`);
    this.audio = audio;
    audio.addEventListener("playing", () => this.cb.handlers().onFirstAudio?.(Math.round(performance.now() - requested)), {
      once: true,
    });
    const done = () => {
      if (this.audio !== audio || this.closed) return;
      this.audio = null;
      this.listen();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  }

  private stopSpeech() {
    if (!this.audio) return;
    this.audio.onended = null;
    this.audio.onerror = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.audio = null;
  }

  private startRecording() {
    const recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start();
    this.recording = { recorder, chunks };
  }

  private stopRecording(): Promise<Blob> {
    const current = this.recording;
    this.recording = null;
    if (!current) return Promise.resolve(new Blob());
    const type = current.recorder.mimeType || "audio/webm";
    return new Promise((resolve) => {
      current.recorder.onstop = () => resolve(new Blob(current.chunks, { type }));
      if (current.recorder.state === "inactive") resolve(new Blob(current.chunks, { type }));
      else current.recorder.stop();
    });
  }

  private discardRecording() {
    const current = this.recording;
    this.recording = null;
    if (current && current.recorder.state !== "inactive") {
      current.recorder.ondataavailable = null;
      current.recorder.stop();
    }
  }
}

export function useVoiceCall({ onUtterance, onError, onFirstAudio }: Options) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [level, setLevel] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const engineRef = useRef<CallEngine | null>(null);
  // Обработчики в ref: звонок живёт дольше перерисовки и должен звать свежие, с актуальным состоянием диалога.
  const handlersRef = useRef<Options>({ onUtterance, onError, ...(onFirstAudio ? { onFirstAudio } : {}) });
  useEffect(() => {
    handlersRef.current = { onUtterance, onError, ...(onFirstAudio ? { onFirstAudio } : {}) };
  });

  const hangUp = useCallback(() => {
    engineRef.current?.close();
    engineRef.current = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    if (engineRef.current) return;
    setActive(true);
    setPhase("connecting");
    setStartedAt(Date.now());
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch {
      setActive(false);
      handlersRef.current.onError("mic_denied");
      return;
    }
    engineRef.current = new CallEngine(stream, { phase: setPhase, level: setLevel, handlers: () => handlersRef.current });
  }, []);

  useEffect(() => () => engineRef.current?.close(), []);

  return { active, phase, level, startedAt, start, hangUp };
}
