"use client";

import { INITIAL_CLIENT_STATE, type ClientDialogState, type TurnTrace } from "@voice-router/core";
import { useCallback, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { AppHeader } from "./AppHeader";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { StatusLine } from "./StatusLine";
import { TracePanel } from "./TracePanel";
import { TurnHistory } from "./TurnHistory";
import { postTurn, type TurnFailure } from "./turn-client";
import type { ChatMessage, VoiceStatus } from "./types";

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

  const nextId = useRef(1);
  // Ref, а не state: голосовой колбэк может прийти раньше перерисовки, и второй запрос не должен уйти.
  const pendingRef = useRef(false);

  const pushMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => [...current, message]);
  }, []);

  const sendUtterance = useCallback(
    async (utterance: string, sttMs?: number) => {
      const text = utterance.trim();
      if (!text || pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      pushMessage({ id: nextId.current++, role: "client", text });

      const result = await postTurn(sttMs === undefined ? { utterance: text, state: dialogState } : { utterance: text, state: dialogState, sttMs });

      if (result.ok) {
        const { reply, trace, state } = result.data;
        setDialogState(state);
        setTraces((current) => [...current, trace]);
        setSelectedTurn(null);
        pushMessage({ id: nextId.current++, role: "bot", text: reply.text });
      } else {
        pushMessage(failureMessage(nextId.current++, result.failure));
      }
      pendingRef.current = false;
      setPending(false);
    },
    [dialogState, pushMessage],
  );

  const resetConversation = useCallback(() => {
    setDialogState(INITIAL_CLIENT_STATE);
    setMessages([]);
    setTraces([]);
    setSelectedTurn(null);
  }, []);

  const status: VoiceStatus = pending ? "thinking" : "idle";
  const shownIndex = selectedTurn ?? traces.length - 1;
  const shownTrace = traces[shownIndex];

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
          <div className="voice-bar">
            <div className="voice-bar__controls">
              <StatusLine status={status} />
            </div>
          </div>
          <MessageList messages={messages} />
          <Composer disabled={pending} onSend={(text) => void sendUtterance(text)} />
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
