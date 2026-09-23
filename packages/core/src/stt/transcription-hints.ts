import type { Glossary } from "./glossary";

/**
 * Подсказка для OpenAI speech-to-text из словаря терминов (issue #8).
 *
 * Возвращает поля, которые одинаково передаются в POST /v1/audio/transcriptions и в
 * session.audio.input.transcription Realtime-сессии: model, prompt, keywords, languages.
 *
 * Языки. Клиент говорит по-русски, по-казахски и переходит с языка на язык внутри фразы.
 *  - gpt-transcribe и gpt-live-transcribe принимают список ожидаемых языков `languages` —
 *    передаём ["ru", "kk"]: модель ждёт оба языка и не переводит казахскую речь в русскую.
 *  - Остальные модели принимают только один `language`. Его не задаём: фиксированный язык ломает
 *    смешанную речь. Ожидание обоих языков задаёт подсказка — в ней фразы клиента на ru и на kk.
 *
 * Термины. Модели лучше держат стиль по естественной фразе, чем по голому списку, поэтому подсказка —
 * короткие реплики клиента из набора с самыми важными терминами, затем список оставшихся терминов.
 * Где поддерживаются keywords, термины дополнительно передаются списком.
 */

export const STT_MODELS = [
  "gpt-transcribe",
  "gpt-live-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "whisper-1",
] as const;

export type SttModel = (typeof STT_MODELS)[number];
export type SttLanguage = "ru" | "kk";

export interface TranscriptionHints {
  model: SttModel;
  prompt?: string;
  keywords?: string[];
  languages?: SttLanguage[];
}

interface ModelBudget {
  /** Предел длины подсказки в символах. */
  promptChars: number;
  /** Предел числа ключевых слов; 0 — модель не принимает keywords. */
  maxKeywords: number;
  /** Модель принимает список ожидаемых языков `languages`. */
  multiLanguage: boolean;
}

/**
 * Бюджеты. У whisper-1 документированный предел подсказки — 224 токена; кириллица и казахские буквы
 * занимают больше токенов на символ, поэтому 200 символов — с запасом. Для моделей gpt-* точный предел
 * подсказки и числа keywords в документации не указан; 800 символов и 40 ключевых слов — наше
 * консервативное допущение: подсказка должна описывать разговор, а не пересказывать весь каталог.
 */
const BUDGETS: Record<SttModel, ModelBudget> = {
  "gpt-transcribe": { promptChars: 800, maxKeywords: 40, multiLanguage: true },
  "gpt-live-transcribe": { promptChars: 800, maxKeywords: 40, multiLanguage: true },
  "gpt-4o-transcribe": { promptChars: 800, maxKeywords: 0, multiLanguage: false },
  "gpt-4o-mini-transcribe": { promptChars: 800, maxKeywords: 0, multiLanguage: false },
  "whisper-1": { promptChars: 200, maxKeywords: 0, multiLanguage: false },
};

/** Доля подсказки под фразы клиента; остаток — под список терминов, которых во фразах не оказалось. */
const PHRASE_SHARE = 0.6;

/** API не принимает в keywords скобки и переводы строки. */
const KEYWORD_FORBIDDEN = /[()[\]{}\n\r]/;

export interface HintOptions {
  model: SttModel;
  languages?: SttLanguage[];
  promptChars?: number;
  maxKeywords?: number;
}

/** Подсказка из словаря всегда содержит prompt; без подсказки (базовая линия оценки) — только model. */
type GlossaryHints = TranscriptionHints & { prompt: string };

function build(glossary: Glossary, options: HintOptions): GlossaryHints {
  const budget = BUDGETS[options.model];
  const promptChars = options.promptChars ?? budget.promptChars;
  const maxKeywords = options.maxKeywords ?? budget.maxKeywords;

  // Аббревиатуры первыми: их распознавание страдает сильнее всего; внутри групп — порядок словаря.
  const ranked = [
    ...glossary.terms.filter((t) => t.kind === "acronym"),
    ...glossary.terms.filter((t) => t.kind !== "acronym"),
  ].map((t) => t.term);

  const hints: GlossaryHints = { model: options.model, prompt: composePrompt(glossary, ranked, promptChars) };
  if (maxKeywords > 0) {
    const keywords = [...ranked, ...glossary.identifiers.map((i) => i.keyword)].filter((k) => !KEYWORD_FORBIDDEN.test(k));
    hints.keywords = [...new Set(keywords)].slice(0, maxKeywords);
  }
  if (budget.multiLanguage) hints.languages = options.languages ?? ["ru", "kk"];
  return hints;
}

function composePrompt(glossary: Glossary, ranked: string[], limit: number): string {
  const sentence = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);
  const phraseLimit = Math.floor(limit * PHRASE_SHARE);
  const chosen: string[] = [];
  const covered = new Set<string>();
  const perLang = { ru: 0, kk: 0 };
  let length = 0;

  for (const term of ranked) {
    if (covered.has(term)) continue;
    // Фразы чередуются по языкам: сначала язык, фраз на котором в подсказке меньше.
    const candidates = glossary.phrases
      .filter((p) => p.terms.includes(term))
      .sort((a, b) => perLang[a.lang] - perLang[b.lang] || a.text.length - b.text.length);
    const phrase = candidates.find((p) => length + (length ? 1 : 0) + sentence(p.text).length <= phraseLimit);
    if (!phrase) continue;
    chosen.push(sentence(phrase.text));
    length += (length ? 1 : 0) + sentence(phrase.text).length;
    perLang[phrase.lang] += 1;
    for (const t of phrase.terms) covered.add(t);
  }

  let prompt = chosen.join(" ");
  const rest: string[] = [];
  for (const term of ranked) {
    if (covered.has(term)) continue;
    const candidate = `${prompt}${prompt ? " " : ""}${[...rest, term].join(", ")}.`;
    if (candidate.length > limit) break;
    rest.push(term);
  }
  if (rest.length > 0) prompt = `${prompt}${prompt ? " " : ""}${rest.join(", ")}.`;
  return prompt;
}

export const buildTranscriptionHints = Object.assign(build, {
  /** Бюджет модели по умолчанию — для проверок и отчёта оценки. */
  budget: (model: SttModel): ModelBudget => BUDGETS[model],
});

/** Поля multipart для POST /v1/audio/transcriptions: массивы — повторяющимися полями с []. */
export function toTranscriptionFormFields(hints: TranscriptionHints): Array<[string, string]> {
  const fields: Array<[string, string]> = [["model", hints.model]];
  if (hints.prompt) fields.push(["prompt", hints.prompt]);
  for (const keyword of hints.keywords ?? []) fields.push(["keywords[]", keyword]);
  for (const language of hints.languages ?? []) fields.push(["languages[]", language]);
  return fields;
}
