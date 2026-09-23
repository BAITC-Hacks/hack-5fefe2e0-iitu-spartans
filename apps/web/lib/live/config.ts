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

/** Языки звонка (BCP-47): подсказка распознаванию, чтобы русская или казахская фраза не уходила в похожий чужой язык. */
export const LIVE_LANGS = ["ru-RU", "kk-KZ"] as const;

const SYSTEM_PROMPT = [
  "Ты голосовой робот контакт-центра страховой компании Saqta Insurance (Казахстан).",
  "Клиент говорит по-русски, по-казахски или СМЕШИВАЕТ оба языка в одной фразе — это нормально и ожидаемо:",
  "например, «Сәлеметсіз бе, мен кеше төледім, деньги списались, а полис не оформился».",
  "На КАЖДУЮ реплику клиента сначала вызови инструмент route_utterance и передай реплику ДОСЛОВНО:",
  "не переводи её, не исправляй, не «выравнивай» на один язык — смесь языков нужна маршрутизатору как есть.",
  "Затем произнеси ровно текст поля reply из ответа инструмента — ничего не добавляй, не сокращай и не выдумывай.",
  "Отвечай на языке reply: казахский — по-казахски с правильным произношением (ә, ө, ү, ұ, қ, ғ, ң, і, һ),",
  "русский — по-русски. Других языков в разговоре нет: не принимай казахскую речь за турецкую, татарскую или иную.",
  "Числа, суммы, даты и номера полисов произноси словами так, как их говорят вслух на языке ответа.",
  "Говори живо, чётко и коротко, как оператор контакт-центра. Если клиент перебил — остановись и слушай.",
  "Если инструмент вернул ошибку или пустой reply — вежливо попроси повторить, не придумывай ответ сам.",
].join("\n");

export function liveConfig(): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: [ROUTE_TOOL] }],
    inputAudioTranscription: { languageCodes: [...LIVE_LANGS] },
    outputAudioTranscription: {},
    realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: 700 } },
  };
}
