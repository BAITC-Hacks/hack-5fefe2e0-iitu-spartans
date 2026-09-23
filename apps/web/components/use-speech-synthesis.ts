"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function voiceFor(voices: SpeechSynthesisVoice[], bcp47: string): SpeechSynthesisVoice | undefined {
  const prefix = bcp47.slice(0, 2).toLowerCase();
  const exact = voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix));
  if (exact) return exact;
  // Казахского голоса в большинстве систем нет. Русский голос читает казахскую кириллицу
  // заметно понятнее, чем голос по умолчанию (часто английский), поэтому он — запасной вариант.
  if (prefix === "kk") return voices.find((voice) => voice.lang.toLowerCase().startsWith("ru"));
  return undefined;
}

export function useSpeechSynthesis() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // Chromium может собрать сборщиком мусора объект реплики без ссылки, и тогда onend не придёт никогда.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const synth = window.speechSynthesis;
    // Список голосов в Chromium приходит асинхронно: первый вызов часто возвращает пустой массив.
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => {
      synth.removeEventListener("voiceschanged", load);
      synth.cancel();
    };
  }, []);

  const speak = useCallback(
    (text: string, bcp47: string) => {
      if (!("speechSynthesis" in window) || !text.trim()) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = voiceFor(voices, bcp47);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = bcp47;
      }
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      utteranceRef.current = utterance;
      synth.speak(utterance);
    },
    [voices],
  );

  const cancel = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const hasKazakhVoice = voices.some((voice) => voice.lang.toLowerCase().startsWith("kk"));

  return { supported, speaking, speak, cancel, hasKazakhVoice, voicesLoaded: voices.length > 0 };
}
