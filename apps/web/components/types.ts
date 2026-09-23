import type { MessageKey } from "../lib/i18n";

/** Состояние робота для строки статуса и кнопки микрофона. */
export type VoiceStatus = "idle" | "listening" | "thinking" | "speaking";

/**
 * Сообщение ленты разговора. Ошибки хранятся ключом словаря, а не готовым текстом,
 * чтобы при смене языка интерфейса они перевелись вместе с остальными подписями.
 */
export type ChatMessage =
  | { id: number; role: "client" | "bot"; text: string }
  | { id: number; role: "error"; key: MessageKey; vars?: Record<string, string | number>; detail?: string };
