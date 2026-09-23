import type { Catalog } from "./catalog";

/**
 * Тестовый фрагмент каталога. Структура полей повторяет scenarios.json стартового набора; три сценария
 * выбраны на стыке, который набор описывает как трудный: статус выплаты против несогласия с решением.
 */
export const CATALOG_FIXTURE: Catalog = {
  scenarios: [
    {
      scenario_id: "SC17",
      name: "Claim status",
      description: "Client wants to know the status of an existing claim or payout.",
      not_this_if: [
        { condition: "Client disagrees with the decision or the amount", use_instead: "SC19" },
        { condition: "Client asks which documents are needed", use_instead: "SC18" },
      ],
      priority: "normal",
      examples: {
        ru: ["Какой статус по моему заявлению?", "Когда будет выплата?", "Подавал документы две недели назад, что с ними?"],
        kk: ["Өтінішім қандай күйде?", "Төлем қашан болады?"],
      },
    },
    {
      scenario_id: "SC19",
      name: "Claim decision dispute",
      description: "Client disagrees with a claim decision or the payout amount.",
      not_this_if: [{ condition: "Client only asks about the status", use_instead: "SC17" }],
      priority: "high",
      examples: { ru: ["Выплату одобрили, но сумма слишком маленькая"], kk: ["Төлем сомасы тым аз"] },
    },
    {
      scenario_id: "SC11",
      name: "Accident just happened",
      description: "A road accident has just happened and the client needs immediate help.",
      not_this_if: [],
      priority: "urgent",
      examples: { ru: ["Я только что попал в аварию"], kk: ["Жаңа ғана жол апатына түстім"] },
    },
  ],
  system_intents: [
    { id: "SYS_OUT_OF_SCOPE", description: "Request is not about the insurer's services." },
    { id: "SYS_UNCLEAR", description: "Ask one clarifying question." },
    { id: "SYS_GOODBYE", description: "Client ends the conversation." },
  ],
};

/** Корректный ответ модели для реплики о статусе выплаты. */
export const VALID_ANSWER = JSON.stringify({
  scenarios: [{ scenario_id: "SC17", confidence: 0.88, reason: "asks when the payout will arrive, no dispute" }],
  alternatives: [{ scenario_id: "SC19", confidence: 0.2 }],
  language: "ru",
  slots: {},
  is_continuation: false,
});
