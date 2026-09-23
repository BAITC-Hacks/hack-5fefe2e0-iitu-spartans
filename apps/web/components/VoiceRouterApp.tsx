"use client";

import { INITIAL_CLIENT_STATE, type ClientDialogState, type Language, type TurnTrace } from "@voice-router/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { AppHeader } from "./AppHeader";
import { CallScreen, CallStartButton } from "./CallScreen";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { TracePanel } from "./TracePanel";
import { TurnHistory } from "./TurnHistory";
import { postTurn, type TurnFailure } from "./turn-client";
import type { ChatMessage, VoiceStatus } from "./types";
import { useSpeechRecognition, type RecognitionLang } from "./use-speech-recognition";
import { useSpeechSynthesis } from "./use-speech-synthesis";
import { useVoiceCall, type CallReply } from "./use-voice-call";
import { VoiceBar } from "./VoiceBar";

// Смешанную реплику озвучиваем языком, на котором клиент говорил в микрофон:
// так ответ звучит тем голосом, который клиент только что выбрал сам.
function speechLangFor(language: Language, recognitionLang: RecognitionLang): string {
  if (language === "kk") return "kk-KZ";
  if (language === "ru") return "ru-RU";
  return recognitionLang;
}

function failureMessage(id: number, failure: TurnFailure): ChatMessage {
  switch (failure.kind) {
    case "http":
      return failure.detail
        ? { id, role: "error", key: "error.http", vars: { status: failure.status }, detail: failure.detail }
        : { id, role: "error", key: "error.http", vars: { status: failure.status } };
    case "network":
      return { id, role: "error", key: "error.network" };
    case "bad-response":
      return { id, role: "error", key: "error.badResponse" };
  }
}

/** Экран демо: слева разговор с роботом, справа панель супервизора по последнему ходу. */
export function VoiceRouterApp() {
  const { t } = useI18n();

  // Сервер не хранит сессию: состояние диалога живёт здесь и уходит с каждой репликой.
  const [dialogState, setDialogState] = useState<ClientDialogState>(INITIAL_CLIENT_STATE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [traces, setTraces] = useState<TurnTrace[]>([]);
  const [pending, setPending] = useState(false);
  // null — панель следит за последним ходом; число — супервизор открыл прошлый ход из истории.
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const [recognitionLang, setRecognitionLang] = useState<RecognitionLang>("ru-RU");
  const [speakReplies, setSpeakReplies] = useState(true);
  // null — ещё не спросили сервер. Режим звонка доступен, когда на сервере есть ключ модели (распознавание и голос);
  // без ключа остаются голос браузера и текст (Положение §5.6.6).
  const [serverVoice, setServerVoice] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/stt")
      .then((r) => r.json() as Promise<{ available?: boolean }>)
      .then((body) => setServerVoice(body.available === true))
      .catch(() => setServerVoice(false));
  }, []);

  const synthesis = useSpeechSynthesis();
  const nextId = useRef(1);
  // Ref, а не state: голосовой колбэк может прийти раньше перерисовки, и второй запрос не должен уйти.
  const pendingRef = useRef(false);

  const pushMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => [...current, message]);
  }, []);

  const sendUtterance = useCallback(
    async (utterance: string, sttMs?: number, speak = true): Promise<CallReply | null> => {
      const text = utterance.trim();
      if (!text || pendingRef.current) return null;
      pendingRef.current = true;
      setPending(true);
      pushMessage({ id: nextId.current++, role: "client", text });

      const result = await postTurn(sttMs === undefined ? { utterance: text, state: dialogState } : { utterance: text, state: dialogState, sttMs });
      let answer: CallReply | null = null;

      if (result.ok) {
        const { reply, trace, state } = result.data;
        setDialogState(state);
        setTraces((current) => [...current, trace]);
        setSelectedTurn(null);
        pushMessage({ id: nextId.current++, role: "bot", text: reply.text });
        answer = { text: reply.text, language: reply.language };
        if (speak && speakReplies) synthesis.speak(reply.text, speechLangFor(reply.language, recognitionLang));
      } else {
        pushMessage(failureMessage(nextId.current++, result.failure));
      }
      pendingRef.current = false;
      setPending(false);
      return answer;
    },
    [dialogState, pushMessage, speakReplies, synthesis.speak, recognitionLang],
  );

  // В звонке ответ озвучивает голос сервера, поэтому голос браузера здесь не включается.
  const call = useVoiceCall({
    onUtterance: (text, sttMs) => sendUtterance(text, sttMs, false),
    onError: (code) =>
      pushMessage(
        code === "mic_denied"
          ? { id: nextId.current++, role: "error", key: "call.micDenied" }
          : { id: nextId.current++, role: "error", key: "mic.sttError", vars: { code } },
      ),
  });

  const startCall = useCallback(() => {
    synthesis.cancel();
    void call.start();
  }, [synthesis.cancel, call.start]);

  const recognition = useSpeechRecognition({
    lang: recognitionLang,
    onFinal: (transcript, sttMs) => void sendUtterance(transcript, sttMs),
    onError: (code) => pushMessage({ id: nextId.current++, role: "error", key: "mic.error", vars: { code } }),
  });

  const startListening = useCallback(() => {
    // Робот замолкает, когда клиент начинает говорить: иначе микрофон запишет его собственный голос.
    synthesis.cancel();
    recognition.start();
  }, [synthesis.cancel, recognition.start]);

  const resetConversation = useCallback(() => {
    synthesis.cancel();
    recognition.stop();
    call.hangUp();
    setDialogState(INITIAL_CLIENT_STATE);
    setMessages([]);
    setTraces([]);
    setSelectedTurn(null);
  }, [synthesis.cancel, recognition.stop, call.hangUp]);

  // Приоритет статусов: слушание важнее ожидания ответа, ожидание важнее озвучивания.
  const status: VoiceStatus = recognition.listening
    ? "listening"
    : pending
      ? "thinking"
      : synthesis.speaking
        ? "speaking"
        : "idle";
  const shownIndex = selectedTurn ?? traces.length - 1;
  const shownTrace = traces[shownIndex];
  const lastTrace = traces[traces.length - 1];
  const lastScenario = lastTrace?.decision?.scenarios[0];
  const lastClient = [...messages].reverse().find((m) => m.role === "client");
  const lastBot = [...messages].reverse().find((m) => m.role === "bot");

  return (
    <>
      <AppHeader />
      <main className="app-main">
        <section className="card" aria-labelledby="conversation-title">
          <div className="card__header">
            <h2 id="conversation-title" className="card__title">
              {t("conv.title")}
            </h2>
            <button type="button" className="button button--ghost" onClick={resetConversation} disabled={pending}>
              {t("conv.reset")}
            </button>
          </div>
          {call.active ? (
            <CallScreen
              phase={call.phase}
              level={call.level}
              startedAt={call.startedAt}
              {...(lastClient?.role === "client" ? { clientText: lastClient.text } : {})}
              {...(lastBot?.role === "bot" ? { botText: lastBot.text } : {})}
              {...(lastScenario
                ? {
                    scenario: {
                      id: lastScenario.scenario_id,
                      name: lastTrace?.scenarioNames[lastScenario.scenario_id] ?? lastScenario.scenario_id,
                      confidence: lastScenario.confidence,
                    },
                  }
                : {})}
              onHangUp={call.hangUp}
            />
          ) : (
            <>
              {serverVoice ? <CallStartButton onStart={startCall} disabled={pending || recognition.listening} /> : null}
              <VoiceBar
                status={status}
                recognitionSupported={recognition.supported}
                synthesisSupported={synthesis.supported}
                listening={recognition.listening}
                busy={pending}
                lang={recognitionLang}
                onLangChange={setRecognitionLang}
                speakReplies={speakReplies}
                onSpeakRepliesChange={(value) => {
                  setSpeakReplies(value);
                  if (!value) synthesis.cancel();
                }}
                showNoKazakhVoice={
                  recognitionLang === "kk-KZ" && synthesis.supported === true && synthesis.voicesLoaded && !synthesis.hasKazakhVoice
                }
                onStart={startListening}
                onStop={recognition.stop}
              />
              <MessageList messages={messages} />
              <Composer disabled={pending} onSend={(text) => void sendUtterance(text)} />
            </>
          )}
        </section>
        <aside className="card" aria-labelledby="trace-title">
          <div className="card__header">
            <h2 id="trace-title" className="card__title">
              {t("trace.title")}
            </h2>
            {shownTrace ? <span className="badge badge--turn">{t("trace.turn", { n: shownTrace.turn })}</span> : null}
          </div>
          {shownTrace ? <TracePanel trace={shownTrace} /> : <p className="muted">{t("trace.empty")}</p>}
          <section className="section">
            <h3 className="section__title">{t("history.title")}</h3>
            <TurnHistory traces={traces} selected={shownIndex} onSelect={setSelectedTurn} />
          </section>
        </aside>
      </main>
    </>
  );
}
