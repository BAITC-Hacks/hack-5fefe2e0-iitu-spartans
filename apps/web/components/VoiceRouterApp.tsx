"use client";

import { INITIAL_CLIENT_STATE, type ClientDialogState, type Language, type TurnTrace } from "@voice-router/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { AppHeader } from "./AppHeader";
import { CallScreen, CallStartButton } from "./CallScreen";
import { fetchEngines, postCompare, type EngineInfo } from "./compare-client";
import { CompareModal, type CompareState } from "./CompareModal";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { SettingsModal } from "./SettingsModal";
import { SupervisorStats } from "./SupervisorStats";
import { TracePanel } from "./TracePanel";
import { TurnHistory } from "./TurnHistory";
import { postTurn, type TurnFailure } from "./turn-client";
import type { ChatMessage, TurnVoice, VoicePath, VoiceStatus } from "./types";
import { ttsUrl } from "../lib/voice/server-voice";
import { usePushToTalk } from "./use-push-to-talk";
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
  // Серверное распознавание кнопки микрофона отказало (сеть, 5xx, нет ключа) — до нового разговора слушает браузер.
  const [sttServerFailed, setSttServerFailed] = useState(false);
  // Какой путь распознавания и озвучки сработал в каждом ходе (по индексу трассировки) — для панели супервизора.
  const [voiceByTurn, setVoiceByTurn] = useState<Record<number, TurnVoice>>({});
  const [lastTtsPath, setLastTtsPath] = useState<VoicePath | null>(null);
  const [serverSpeaking, setServerSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Индекс следующей трассировки: колбэки озвучки приходят позже перерисовки и должны найти свой ход.
  const traceCountRef = useRef(0);

  useEffect(() => {
    fetch("/api/stt")
      .then((r) => r.json() as Promise<{ available?: boolean }>)
      .then((body) => setServerVoice(body.available === true))
      .catch(() => setServerVoice(false));
  }, []);

  // Окно сравнения движков: кнопка появляется, когда на сервере настроен хотя бы один движок.
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [compare, setCompare] = useState<CompareState>({ status: "idle" });
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareIndex, setCompareIndex] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    void fetchEngines().then(setEngines);
  }, []);
  // Состояние диалога, с которым уходил каждый ход: сравнение повторяет ход в том же контексте, что и робот.
  const turnStatesRef = useRef<ClientDialogState[]>([]);

  const synthesis = useSpeechSynthesis();
  const nextId = useRef(1);
  // Ref, а не state: голосовой колбэк может прийти раньше перерисовки, и второй запрос не должен уйти.
  const pendingRef = useRef(false);

  const pushMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => [...current, message]);
  }, []);

  /** Первый звук ответа хода index: задержка и путь озвучки уходят в трассировку этого хода. */
  const recordFirstAudio = useCallback((index: number, ms: number, path: VoicePath) => {
    setTraces((current) =>
      current.map((trace, i) => (i === index ? { ...trace, latencyMs: { ...trace.latencyMs, ttsFirstAudio: ms } } : trace)),
    );
    setVoiceByTurn((current) => ({ ...current, [index]: { ...current[index], tts: path } }));
    setLastTtsPath(path);
  }, []);

  const stopServerAudio = useCallback(() => {
    const audio = audioRef.current;
    audioRef.current = null;
    setServerSpeaking(false);
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }, []);

  const stopSpeaking = useCallback(() => {
    synthesis.cancel();
    stopServerAudio();
  }, [synthesis.cancel, stopServerAudio]);

  /**
   * Озвучка ответа: голос сервера (казахский есть), при сбое до первого звука — голос браузера (Положение §5.6.6).
   * Время считается от готового текста ответа до первого звука — это «tts_first_audio» трассировки.
   */
  const speakReply = useCallback(
    (text: string, language: Language, index: number) => {
      const started = performance.now();
      const viaBrowser = () =>
        synthesis.speak(text, speechLangFor(language, recognitionLang), () =>
          recordFirstAudio(index, Math.round(performance.now() - started), "browser"),
        );
      if (!serverVoice) {
        viaBrowser();
        return;
      }
      stopServerAudio();
      const audio = new Audio(ttsUrl(text, language));
      audioRef.current = audio;
      let played = false;
      audio.addEventListener(
        "playing",
        () => {
          played = true;
          setServerSpeaking(true);
          recordFirstAudio(index, Math.round(performance.now() - started), "server");
        },
        { once: true },
      );
      audio.onended = () => {
        if (audioRef.current !== audio) return;
        audioRef.current = null;
        setServerSpeaking(false);
      };
      const fail = () => {
        // Остановили сами (клиент заговорил или новый разговор) — это не сбой озвучки.
        if (audioRef.current !== audio) return;
        audioRef.current = null;
        setServerSpeaking(false);
        if (!played) viaBrowser();
      };
      audio.onerror = fail;
      audio.play().catch(fail);
    },
    [serverVoice, synthesis.speak, recognitionLang, recordFirstAudio, stopServerAudio],
  );

  const sendUtterance = useCallback(
    async (
      utterance: string,
      { sttMs, stt, speak = true }: { sttMs?: number; stt?: VoicePath; speak?: boolean } = {},
    ): Promise<CallReply | null> => {
      const text = utterance.trim();
      if (!text || pendingRef.current) return null;
      pendingRef.current = true;
      setPending(true);
      pushMessage({ id: nextId.current++, role: "client", text });

      const result = await postTurn(sttMs === undefined ? { utterance: text, state: dialogState } : { utterance: text, state: dialogState, sttMs });
      let answer: CallReply | null = null;

      if (result.ok) {
        const { reply, trace, state } = result.data;
        turnStatesRef.current.push(dialogState);
        setDialogState(state);
        const index = traceCountRef.current++;
        setTraces((current) => [...current, trace]);
        if (stt) setVoiceByTurn((current) => ({ ...current, [index]: { stt } }));
        setSelectedTurn(null);
        pushMessage({ id: nextId.current++, role: "bot", text: reply.text });
        answer = { text: reply.text, language: reply.language };
        if (speak && speakReplies) speakReply(reply.text, reply.language, index);
      } else {
        pushMessage(failureMessage(nextId.current++, result.failure));
      }
      pendingRef.current = false;
      setPending(false);
      return answer;
    },
    [dialogState, pushMessage, speakReplies, speakReply],
  );

  // В звонке ответ озвучивает голос сервера, поэтому голос браузера здесь не включается.
  const call = useVoiceCall({
    onUtterance: (text, sttMs) => sendUtterance(text, { sttMs, stt: "server", speak: false }),
    onFirstAudio: (ms) => recordFirstAudio(traceCountRef.current - 1, ms, "server"),
    onError: (code) =>
      pushMessage(
        code === "mic_denied"
          ? { id: nextId.current++, role: "error", key: "call.micDenied" }
          : { id: nextId.current++, role: "error", key: "mic.sttError", vars: { code } },
      ),
  });

  const startCall = useCallback(() => {
    stopSpeaking();
    void call.start();
  }, [stopSpeaking, call.start]);

  const recognition = useSpeechRecognition({
    lang: recognitionLang,
    onFinal: (transcript, sttMs) => void sendUtterance(transcript, { sttMs, stt: "browser" }),
    onError: (code) => pushMessage({ id: nextId.current++, role: "error", key: "mic.error", vars: { code } }),
  });

  const pushToTalk = usePushToTalk({
    onResult: (outcome, sttMs) => {
      if (outcome.ok) {
        void sendUtterance(outcome.text, { sttMs, stt: "server" });
        return;
      }
      if (outcome.fallback) {
        setSttServerFailed(true);
        pushMessage({ id: nextId.current++, role: "error", key: "mic.sttFallback", vars: { code: outcome.error } });
      } else {
        pushMessage({ id: nextId.current++, role: "error", key: "mic.sttError", vars: { code: outcome.error } });
      }
    },
    onMicDenied: () => pushMessage({ id: nextId.current++, role: "error", key: "call.micDenied" }),
  });

  // Кнопка микрофона: серверное распознавание при ключе модели, браузерное — без ключа или после отказа сервера.
  const sttPath: VoicePath | null = serverVoice === null ? null : serverVoice && !sttServerFailed ? "server" : "browser";
  const pttActive = pushToTalk.phase === "starting" || pushToTalk.phase === "recording";

  const startListening = useCallback(() => {
    // Робот замолкает, когда клиент начинает говорить: иначе микрофон запишет его собственный голос.
    stopSpeaking();
    if (sttPath === "server") void pushToTalk.start();
    else recognition.start();
  }, [stopSpeaking, sttPath, pushToTalk.start, recognition.start]);

  const stopListening = useCallback(() => {
    if (sttPath === "server") pushToTalk.stop();
    else recognition.stop();
  }, [sttPath, pushToTalk.stop, recognition.stop]);

  const resetConversation = useCallback(() => {
    stopSpeaking();
    recognition.stop();
    pushToTalk.cancel();
    call.hangUp();
    setDialogState(INITIAL_CLIENT_STATE);
    setMessages([]);
    setTraces([]);
    setVoiceByTurn({});
    traceCountRef.current = 0;
    setSttServerFailed(false);
    setSelectedTurn(null);
    turnStatesRef.current = [];
    setCompare({ status: "idle" });
    setCompareIndex(null);
  }, [stopSpeaking, recognition.stop, pushToTalk.cancel, call.hangUp]);

  const runCompare = useCallback(
    async (index: number) => {
      const trace = traces[index];
      if (!trace) return;
      const state = turnStatesRef.current[index] ?? INITIAL_CLIENT_STATE;
      setCompareIndex(index);
      setCompareOpen(true);
      setCompare({ status: "loading", utterance: trace.transcript });
      const result = await postCompare({ utterance: trace.transcript, state });
      setCompare(
        result.ok ? { status: "done", data: result.data } : { status: "error", utterance: trace.transcript, failure: result.failure },
      );
    },
    [traces],
  );

  // Приоритет статусов: слушание важнее ожидания ответа, ожидание важнее озвучивания.
  const listening = recognition.listening || pttActive;
  const status: VoiceStatus = listening
    ? "listening"
    : pending || pushToTalk.phase === "transcribing"
      ? "thinking"
      : synthesis.speaking || serverSpeaking
        ? "speaking"
        : "idle";
  const shownIndex = selectedTurn ?? traces.length - 1;
  const shownTrace = traces[shownIndex];
  const lastTrace = traces[traces.length - 1];
  const lastScenario = lastTrace?.decision?.scenarios[0];
  const lastClient = [...messages].reverse().find((m) => m.role === "client");
  const lastBot = [...messages].reverse().find((m) => m.role === "bot");
  const compareAvailable = engines.some((engine) => engine.available);

  return (
    <>
      <AppHeader />
      <main className="app-main">
        <section className="card" aria-labelledby="conversation-title">
          <div className="card__header">
            <h2 id="conversation-title" className="card__title">
              {t("conv.title")}
            </h2>
            <div className="card__actions">
              {serverVoice && !call.active ? <CallStartButton onStart={startCall} disabled={pending || listening} /> : null}
              <button type="button" className="button button--ghost button--small" onClick={() => setSettingsOpen(true)}>
                {t("settings.open")}
              </button>
              <button type="button" className="button button--ghost button--small" onClick={resetConversation} disabled={pending}>
                {t("conv.reset")}
              </button>
            </div>
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
              <VoiceBar
                status={status}
                micAvailable={sttPath === null ? null : sttPath === "server" ? pushToTalk.supported : recognition.supported}
                listening={listening}
                busy={pending || pushToTalk.phase === "transcribing"}
                {...(pushToTalk.phase === "recording"
                  ? { hint: "mic.recording" as const }
                  : pushToTalk.phase === "transcribing"
                    ? { hint: "mic.transcribing" as const }
                    : {})}
                channel={{
                  ...(sttPath ? { stt: sttPath } : {}),
                  ...(speakReplies && serverVoice !== null
                    ? { tts: lastTtsPath ?? (serverVoice ? "server" : "browser") }
                    : {}),
                }}
                onStart={startListening}
                onStop={stopListening}
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
            <div className="card__actions">
              {shownTrace ? <span className="badge badge--turn">{t("trace.turn", { n: shownTrace.turn })}</span> : null}
              {compareAvailable ? (
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => void runCompare(shownIndex)}
                  disabled={!shownTrace || compare.status === "loading"}
                >
                  {t("compare.open")}
                </button>
              ) : null}
            </div>
          </div>
          {shownTrace ? (
            <TracePanel trace={shownTrace} {...(voiceByTurn[shownIndex] ? { voice: voiceByTurn[shownIndex] } : {})} />
          ) : (
            <p className="muted">{t("trace.empty")}</p>
          )}
          <section className="section">
            <h3 className="section__title">{t("history.title")}</h3>
            <TurnHistory traces={traces} selected={shownIndex} onSelect={setSelectedTurn} />
          </section>
          <SupervisorStats refreshKey={traces.length} />
        </aside>
      </main>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        lang={recognitionLang}
        onLangChange={setRecognitionLang}
        listening={recognition.listening}
        speakReplies={speakReplies}
        onSpeakRepliesChange={(value) => {
          setSpeakReplies(value);
          if (!value) stopSpeaking();
        }}
        synthesisSupported={synthesis.supported}
        showNoKazakhVoice={
          recognitionLang === "kk-KZ" && synthesis.supported === true && synthesis.voicesLoaded && !synthesis.hasKazakhVoice
        }
        engines={engines}
      />
      <CompareModal
        open={compareOpen}
        state={compare}
        onClose={() => setCompareOpen(false)}
        onRerun={() => {
          if (compareIndex !== null) void runCompare(compareIndex);
        }}
      />
    </>
  );
}
