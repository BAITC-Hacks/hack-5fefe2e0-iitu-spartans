"use client";

import { useState, type FormEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { useI18n } from "../lib/i18n";

/** Текстовый ввод — резервный канал на случай, если микрофон недоступен или шумно. */
export function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const utterance = text.trim();
    if (!utterance || disabled) return;
    onSend(utterance);
    setText("");
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <label htmlFor="composer-input" className="visually-hidden">
        {t("conv.inputLabel")}
      </label>
      <input
        id="composer-input"
        className="composer__input"
        type="text"
        autoComplete="off"
        value={text}
        placeholder={t("conv.inputPlaceholder")}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className="button" disabled={disabled || text.trim() === ""}>
        {t("conv.send")}
        <SendHorizontal size={17} aria-hidden="true" />
      </button>
    </form>
  );
}
