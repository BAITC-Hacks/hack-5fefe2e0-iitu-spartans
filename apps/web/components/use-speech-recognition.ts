"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const RECOGNITION_LANGS = ["ru-RU", "kk-KZ"] as const;
export type RecognitionLang = (typeof RECOGNITION_LANGS)[number];

// Минимальные типы Web Speech API: в lib.dom TypeScript распознавания речи нет,
// потому что стандарт не закреплён и в Chromium он доступен только с префиксом webkit.
interface RecognitionAlternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative | undefined;
}
interface RecognitionResultList {
  readonly length: number;
  readonly [index: number]: RecognitionResult | undefined;
}
interface RecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: RecognitionResultList;
}
interface RecognitionErrorEvent extends Event {
  readonly error: string;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onspeechend: (() => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

interface Options {
  lang: RecognitionLang;
  /** sttMs — сколько прошло от конца речи клиента до готового текста: это вклад распознавания в задержку хода. */
  onFinal: (transcript: string, sttMs: number) => void;
  onError: (code: string) => void;
}

export function useSpeechRecognition({ lang, onFinal, onError }: Options) {
  // null — проверка ещё не выполнялась (на сервере window нет), чтобы не мигать подсказкой при загрузке.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  // Колбэки держим в ref: распознавание живёт дольше одной перерисовки и должно звать свежие обработчики
  // с актуальным состоянием диалога, а не те, что были при нажатии на кнопку.
  const handlersRef = useRef({ onFinal, onError });

  useEffect(() => {
    handlersRef.current = { onFinal, onError };
  });

  useEffect(() => {
    setSupported(recognitionCtor() !== undefined);
    return () => recognitionRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognitionRef.current) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    // Одна реплика на одно нажатие: так ход диалога совпадает с репликой клиента.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let speechEndAt: number | undefined;
    let lastInterimAt: number | undefined;
    let delivered = false;

    recognition.onspeechend = () => {
      speechEndAt = performance.now();
    };
    recognition.onresult = (event) => {
      const now = performance.now();
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        if (!result.isFinal) {
          lastInterimAt = now;
          continue;
        }
        const transcript = result[0]?.transcript.trim() ?? "";
        if (!transcript || delivered) continue;
        delivered = true;
        // Chromium иногда отдаёт финальный результат раньше события speechend; тогда концом речи
        // считаем последний промежуточный результат — это ближайшая наблюдаемая граница.
        const speechEnd = speechEndAt ?? lastInterimAt ?? now;
        handlersRef.current.onFinal(transcript, Math.max(0, Math.round(now - speechEnd)));
      }
    };
    recognition.onerror = (event) => {
      // Тишина и ручная остановка — штатные случаи, а не ошибка, которую стоит показывать клиенту.
      if (event.error !== "no-speech" && event.error !== "aborted") handlersRef.current.onError(event.error);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }, [lang]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { supported, listening, start, stop };
}
