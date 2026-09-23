"use client";

import { useEffect, useRef } from "react";
import { Bot, UserRound, TriangleAlert } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { ChatMessage } from "./types";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const { t } = useI18n();
  const listRef = useRef<HTMLOListElement>(null);

  // Новая реплика должна быть видна сразу, иначе на демо ответ робота уходит под край ленты.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  return (
    <ol ref={listRef} className="messages" aria-label={t("conv.messages")} aria-live="polite">
      {messages.length === 0 ? (
        <li className="messages__empty">
          <span className="welcome-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
          <h3>{t("conv.welcome")}</h3>
          <p>{t("conv.empty")}</p>
          <span className="welcome-languages">Русский <span /> Қазақша</span>
        </li>
      ) : (
        messages.map((message) => {
          if (message.role === "error") {
            return (
              <li key={message.id} className="bubble bubble--error" role="alert">
                <span className="bubble__author"><TriangleAlert size={13} aria-hidden="true" />{t("conv.errorLabel")}</span>
                {t(message.key, message.vars)}
                {message.detail ? ` ${message.detail}` : null}
              </li>
            );
          }
          return (
            <li key={message.id} className={`bubble bubble--${message.role}`}>
              <span className="bubble__author">
                {message.role === "client" ? <UserRound size={13} aria-hidden="true" /> : <Bot size={14} aria-hidden="true" />}
                {t(message.role === "client" ? "conv.client" : "conv.robot")}
              </span>
              {message.text}
            </li>
          );
        })
      )}
    </ol>
  );
}
