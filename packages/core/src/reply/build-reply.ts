import type { Language } from "../contracts/turn";
import type { PolicyAction } from "../policy/decide";
import type { Catalog } from "../router/catalog";

/**
 * Ответ робота по действию политики. Текст берётся из фраз стартового набора (responses сценариев и
 * response системных намерений): робот говорит только то, что есть в данных, и не тратит второй вызов
 * модели на генерацию — это экономит время до начала ответа (ТЗ: ориентир 1,5 секунды).
 */

export type ReplyLanguage = "ru" | "kk";

/** Подписи сценариев для уточняющего вопроса и обещания вернуться к теме: SC29 -> «обновить контактные данные». */
export type ScenarioLabels = Record<ReplyLanguage, Record<string, string>>;

/** Смешанную речь ведём на русском: по правилам набора отвечать на преобладающем языке клиента. */
export function replyLanguage(language: Language): ReplyLanguage {
  return language === "kk" ? "kk" : "ru";
}

const FALLBACK: Record<
  ReplyLanguage,
  { handoff: string; continue: string; nextTopic: string; other: string; unknown: string; openQuestion: string }
> = {
  ru: {
    handoff: "Соединяю с оператором и передаю суть вопроса — повторять не придётся.",
    continue: "Спасибо, продолжаем.",
    nextTopic: "Затем вернёмся к вопросу: {label}.",
    other: "другое",
    unknown: "Не расслышал, повторите, пожалуйста.",
    openQuestion: "Слушаю вас. Подскажите, пожалуйста, с каким вопросом вы обращаетесь?",
  },
  kk: {
    handoff: "Операторға қосамын, сұрағыңыздың мәнін жеткіземін — қайталаудың қажеті жоқ.",
    continue: "Рақмет, жалғастырамыз.",
    nextTopic: "Содан кейін келесі сұраққа ораламыз: {label}.",
    other: "басқа нәрсе",
    unknown: "Естімей қалдым, қайталап жіберіңізші.",
    openQuestion: "Тыңдап тұрмын. Қандай сұрақпен хабарласып тұрсыз, айтып жіберіңізші?",
  },
};

function scenarioOpening(id: string, lang: ReplyLanguage, catalog: Catalog): string {
  // Шаблон SYS_UNCLEAR ждёт два варианта; когда их нет (приветствие, шум), спрашиваем открыто, а не читаем поля шаблона.
  if (id === "SYS_UNCLEAR") return FALLBACK[lang].openQuestion;
  if (id.startsWith("SYS_")) {
    return catalog.system_intents.find((i) => i.id === id)?.response?.[lang] ?? FALLBACK[lang].unknown;
  }
  return catalog.scenarios.find((s) => s.scenario_id === id)?.responses?.[lang].opening ?? FALLBACK[lang].unknown;
}

export function buildReply(
  action: PolicyAction,
  language: Language,
  catalog: Catalog,
  labels: ScenarioLabels,
): string {
  const lang = replyLanguage(language);
  const label = (id: string | undefined) => (id ? labels[lang][id] ?? id : FALLBACK[lang].other);

  switch (action.kind) {
    case "run": {
      const [first, second] = action.queue;
      if (!first) return FALLBACK[lang].unknown;
      const opening = scenarioOpening(first, lang, catalog);
      // Несколько намерений: начинаем с первого (срочные уже впереди) и подтверждаем, что остальное не потеряно.
      return second ? `${opening} ${FALLBACK[lang].nextTopic.replace("{label}", label(second))}` : opening;
    }
    case "clarify": {
      const [optionA, optionB] = action.options;
      // Без хотя бы одного настоящего варианта шаблон «вы хотите A или B?» превращается в чтение полей — спрашиваем открыто.
      if (!optionA) return FALLBACK[lang].openQuestion;
      const template = catalog.system_intents.find((i) => i.id === "SYS_UNCLEAR")?.response?.[lang];
      if (!template) return FALLBACK[lang].unknown;
      return template.replace("{option_a}", label(optionA)).replace("{option_b}", label(optionB));
    }
    case "handoff":
      return FALLBACK[lang].handoff;
    case "continue":
      // Продолжение темы повторяет вопрос сценария, чтобы клиент знал, что назвать: голое «продолжаем» — тупик разговора.
      return `${FALLBACK[lang].continue} ${scenarioOpening(action.scenarioId, lang, catalog)}`;
  }
}
