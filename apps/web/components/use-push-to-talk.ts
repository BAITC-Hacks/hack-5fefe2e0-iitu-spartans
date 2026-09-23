"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseSttResponse, type SttOutcome } from "../lib/voice/server-voice";
import { MIC_CONSTRAINTS, pickRecorderMime } from "./audio-recording";

/**
 * Кнопка микрофона на серверном распознавании: запись MediaRecorder -> POST /api/stt (gpt-transcribe, ru и kk сразу,
 * подсказка из словаря терминов). Распознавание браузера слушает один выбранный язык, не знает терминов набора
 * и в Chrome зависит от серверов Google («network»); запись уходит на наш сервер.
 */

export type PushToTalkPhase = "idle" | "starting" | "recording" | "transcribing";

interface Options {
  /** sttMs — от конца записи до готового текста: загрузка и распознавание, как их ощущает клиент. */
  onResult: (outcome: SttOutcome, sttMs: number) => void;
  onMicDenied: () => void;
}

/** Короче — случайное касание, а не реплика: запрос не отправляется. */
const MIN_RECORDING_MS = 400;

export function usePushToTalk({ onResult, onMicDenied }: Options) {
  const [phase, setPhase] = useState<PushToTalkPhase>("idle");
  const [supported, setSupported] = useState<boolean | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  // Кнопку отпустили, пока браузер ещё выдавал доступ к микрофону: запись остановится сразу после старта.
  const stopRequestedRef = useRef(false);
  const handlersRef = useRef({ onResult, onMicDenied });
  useEffect(() => {
    handlersRef.current = { onResult, onMicDenied };
  });

  useEffect(() => {
    setSupported(typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  const releaseMic = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const finish = useCallback(
    async (blob: Blob, durationMs: number) => {
      releaseMic();
      if (durationMs < MIN_RECORDING_MS || blob.size === 0) {
        setPhase("idle");
        return;
      }
      setPhase("transcribing");
      const releasedAt = performance.now();
      const form = new FormData();
      form.append("audio", blob, "speech");
      const response = await fetch("/api/stt", { method: "POST", body: form }).catch(() => null);
      const outcome = await parseSttResponse(response);
      setPhase("idle");
      handlersRef.current.onResult(outcome, Math.round(performance.now() - releasedAt));
    },
    [releaseMic],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) {
      stopRequestedRef.current = true;
      return;
    }
    recorderRef.current = null;
    if (recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current || phase === "starting" || phase === "transcribing") return;
    stopRequestedRef.current = false;
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch {
      setPhase("idle");
      handlersRef.current.onMicDenied();
      return;
    }
    streamRef.current = stream;
    const mime = pickRecorderMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || "audio/webm";
      void finish(new Blob(chunksRef.current, { type }), performance.now() - startedAtRef.current);
    };
    recorderRef.current = recorder;
    startedAtRef.current = performance.now();
    recorder.start();
    setPhase("recording");
    if (stopRequestedRef.current) stop();
  }, [phase, finish, stop]);

  /** Сброс разговора: запись выбрасывается без распознавания. */
  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    releaseMic();
    setPhase("idle");
  }, [releaseMic]);

  useEffect(() => () => cancel(), [cancel]);

  return { phase, supported, start, stop, cancel };
}
