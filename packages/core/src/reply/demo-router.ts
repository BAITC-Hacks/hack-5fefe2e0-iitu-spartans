import type { RouteDecision } from "../contracts/route-decision";
import type { Catalog } from "../router/catalog";

/**
 * Режим проверки без ключа модели (Положение §5.6.6: проверка без личных аккаунтов участников).
 *
 * Сценарий подбирается по совпадению слов реплики со словами примеров каталога. Это заглушка для запуска
 * системы у проверяющего без ключа, а не путь выбора сценария в решении: основной путь — LLM-маршрутизатор.
 * Решение явно помечено как демо в обосновании, чтобы его нельзя было принять за ответ модели.
 */

const KAZAKH_LETTERS = /[әғқңөұүһі]/i;
/** Первые пять букв как грубая основа слова: «списались» и «списалось» совпадают. */
const STEM = 5;

function stems(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  return new Set(words.filter((w) => w.length >= 3).map((w) => w.slice(0, STEM)));
}

function confidenceFor(overlap: number): number {
  if (overlap >= 3) return 0.8;
  if (overlap === 2) return 0.6;
  if (overlap === 1) return 0.4;
  return 0;
}

export function demoDecision(catalog: Catalog, utterance: string): RouteDecision {
  const words = stems(utterance);
  const vocabularies = catalog.scenarios.map((s) => ({
    id: s.scenario_id,
    stems: stems([...s.examples.ru, ...s.examples.kk].join(" ")),
  }));
  // Редкие слова весят больше частых (IDF): «статус» различает сценарии, а «страховка» есть почти везде.
  const documentFrequency = new Map<string, number>();
  for (const v of vocabularies) for (const w of v.stems) documentFrequency.set(w, (documentFrequency.get(w) ?? 0) + 1);
  const total = vocabularies.length;

  const ranked = vocabularies
    .map((v) => {
      const matched = [...words].filter((w) => v.stems.has(w));
      const score = matched.reduce((sum, w) => sum + Math.log(1 + total / (documentFrequency.get(w) ?? 1)), 0);
      return { id: v.id, overlap: matched.length, score };
    })
    .filter((r) => r.overlap > 0)
    .sort((a, b) => b.score - a.score || b.overlap - a.overlap);

  const language = KAZAKH_LETTERS.test(utterance) ? "kk" : "ru";
  const [best, ...rest] = ranked;
  if (!best) {
    return {
      scenarios: [{ scenario_id: "SYS_UNCLEAR", confidence: 0.3, reason: "демо-режим: совпадений с примерами каталога нет" }],
      alternatives: [],
      language,
      slots: {},
      is_continuation: false,
    };
  }
  return {
    scenarios: [
      {
        scenario_id: best.id,
        confidence: confidenceFor(best.overlap),
        reason: `демо-режим: совпадение слов с примерами каталога (${best.overlap})`,
      },
    ],
    alternatives: rest.slice(0, 2).map((r) => ({ scenario_id: r.id, confidence: confidenceFor(r.overlap) })),
    language,
    slots: {},
    is_continuation: false,
  };
}
