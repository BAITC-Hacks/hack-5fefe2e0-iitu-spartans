import { Modality, Type, type FunctionDeclaration, type LiveConnectConfig } from "@google/genai";

/**
 * Страница /live — звонок через Gemini Live API: один открытый поток, звук в обе стороны, перебивание.
 * Выбор сценария остаётся за нашим LLM-слоем: модель обязана на каждую реплику вызвать инструмент
 * route_utterance (POST /api/turn) и произнести ровно его ответ. Так трассировка, политика и данные набора —
 * те же, что на главной странице; Gemini Live заменяет только канал «микрофон → голос».
 * Конфигурация общая для сервера (ограничения эфемерного токена) и браузера (подключение).
 */

export const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";

export const ROUTE_TOOL: FunctionDeclaration = {
  name: "route_utterance",
  description:
    "Передаёт дословную реплику клиента в LLM-слой выбора сценария контакт-центра Saqta Insurance. Возвращает reply — текст, который нужно произнести клиенту, и выбранный сценарий.",
  parameters: {
    type: Type.OBJECT,
    properties: { utterance: { type: Type.STRING, description: "Дословная реплика клиента на русском или казахском" } },
    required: ["utterance"],
  },
};

const SYSTEM_PROMPT = [
  "Ты голосовой робот контакт-центра страховой компании Saqta Insurance.",
  "На КАЖДУЮ реплику клиента сначала вызови инструмент route_utterance с её дословным текстом.",
  "Затем произнеси ровно текст поля reply из ответа инструмента — ничего не добавляй, не сокращай и не выдумывай.",
  "Языки разговора — только русский и казахский; отвечай на том языке, на котором написан reply.",
  "Говори живо, чётко и коротко, как оператор контакт-центра. Если клиент перебил — остановись и слушай.",
].join("\n");

export function liveConfig(): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: [ROUTE_TOOL] }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 700 } },
  };
}
