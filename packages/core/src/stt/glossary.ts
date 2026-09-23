import { z } from "zod";
import { findTerms, fold, isAcronym, MIN_WORD_LENGTH, stem, transliterate, words } from "./text.ts";

export { transliterate } from "./text.ts";

/**
 * Словарь терминов для распознавания речи (issue #8).
 *
 * Термины извлекаются из данных стартового набора правилами — в коде нет ни одного термина.
 * Источники: scenarios.json (name, description, examples.ru/kk, responses.ru/kk) и slots.json
 * (description, prompt.ru/kk, values, pattern). Проверочные реплики (dev_utterances.json) в сборке
 * не участвуют — на них словарь только оценивается.
 *
 * Правила:
 *  R1 Аббревиатура — слово из 2–6 заглавных букв в репликах клиента или оператора (ОГПО, КАСКО, ДМС).
 *     То же слово строчными («каско») считается той же аббревиатурой. Латинская аббревиатура в названии
 *     или описании (OGPO, DMS) после транслитерации добавляет сценарий в покрытие.
 *  R2 Доменное слово — слово от 4 букв, которое употребляют обе стороны разговора: клиент (examples,
 *     не меньше 2 раз) и оператор (responses или prompt слотов). Общие слова просьбы («хочу»,
 *     «подскажите») говорит только клиент — правило их отсекает; служебные слова, общие для обеих
 *     сторон, отсекает стоп-лист (см. STOP_WORDS). Словоформы сводятся по основе (text.ts).
 *  R3 Язык термина — по языку текстов, где он встречается: ru, kk или общий (shared) для обоих.
 *  R4 Значение enum-слота (ogpo, casco, almaty) после транслитерации, если оно встречается в текстах,
 *     становится термином или помечает найденный термин (slotValues: product_type=ogpo).
 *  R5 Формат номера — литеральный буквенный префикс из pattern слота (SQ-OGPO, CL) и образец номера.
 *  Порядок: покрытие сценариев по убыванию, затем частота в репликах клиента, затем по алфавиту.
 *     Важность считается по репликам клиента: распознаётся речь клиента, а не ответы робота.
 */

// ---------- данные набора ----------

const LangTextsSchema = z.object({ ru: z.array(z.string()).default([]), kk: z.array(z.string()).default([]) });
const ResponsesSchema = z.object({
  ru: z.record(z.string(), z.string()).default({}),
  kk: z.record(z.string(), z.string()).default({}),
});

const KitScenarioSchema = z.object({
  scenario_id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  slots: z.object({ required: z.array(z.string()).default([]), optional: z.array(z.string()).default([]) }).optional(),
  examples: LangTextsSchema,
  responses: ResponsesSchema.default({ ru: {}, kk: {} }),
});

const KitSlotSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().default(""),
  pattern: z.string().optional(),
  values: z.array(z.union([z.string(), z.number()])).optional(),
  prompt: z.object({ ru: z.string().default(""), kk: z.string().default("") }).default({ ru: "", kk: "" }),
});

export type KitScenario = z.input<typeof KitScenarioSchema>;
export type KitSlot = z.input<typeof KitSlotSchema>;
export interface Kit {
  scenarios: KitScenario[];
  slots: KitSlot[];
}

/** Разбор scenarios.json и slots.json. Бросает исключение с путём к полю, если формат не тот. */
export function parseKit(scenariosJson: unknown, slotsJson: unknown): Kit {
  const scenarios = z.object({ scenarios: z.array(KitScenarioSchema) }).safeParse(scenariosJson);
  if (!scenarios.success) throw new Error(`scenarios.json: ${formatIssues(scenarios.error)}`);
  const slots = z.object({ slots: z.array(KitSlotSchema) }).safeParse(slotsJson);
  if (!slots.success) throw new Error(`slots.json: ${formatIssues(slots.error)}`);
  return { scenarios: scenarios.data.scenarios, slots: slots.data.slots };
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

// ---------- артефакт ----------

const LangSchema = z.enum(["ru", "kk", "shared"]);

export const TermSchema = z.object({
  term: z.string(),
  kind: z.enum(["acronym", "word"]),
  lang: LangSchema,
  /** В скольких сценариях термин есть в репликах клиента (для аббревиатур — ещё в названии и описании). */
  coverage: z.number().int().nonnegative(),
  /** Сколько раз термин встречается в репликах клиента (examples). */
  frequency: z.number().int().nonnegative(),
  scenarios: z.array(z.string()),
  /** Словоформы из данных — для сопоставления с транскриптом. */
  forms: z.array(z.string()),
  slotValues: z.array(z.string()),
});

export const IdentifierSchema = z.object({
  slot: z.string(),
  keyword: z.string(),
  sample: z.string(),
});

export const PhraseSchema = z.object({
  lang: z.enum(["ru", "kk"]),
  text: z.string(),
  scenarioId: z.string(),
  /** Термины словаря в этой фразе, по важности. */
  terms: z.array(z.string()),
});

export const GlossarySchema = z.object({
  version: z.literal(1),
  source: z.object({
    scenarios: z.number().int(),
    slots: z.number().int(),
    /** SHA-256 входных файлов; заполняет скрипт сборки, чтобы видеть, из каких данных собран словарь. */
    sha256: z.record(z.string(), z.string()).optional(),
  }),
  terms: z.array(TermSchema),
  ru: z.array(z.string()),
  kk: z.array(z.string()),
  shared: z.array(z.string()),
  identifiers: z.array(IdentifierSchema),
  phrases: z.array(PhraseSchema),
});

export type Term = z.infer<typeof TermSchema>;
export type Identifier = z.infer<typeof IdentifierSchema>;
export type Phrase = z.infer<typeof PhraseSchema>;
export type Glossary = z.infer<typeof GlossarySchema>;

// ---------- правила ----------

/** R2: минимальная частота доменного слова в репликах клиента (минимальная длина — в text.ts). */
const MIN_CLIENT_FREQUENCY = 2;

/**
 * Стоп-лист — не словарь терминов, а правило «служебные слова не термины»: слова от 4 букв, которые
 * употребляют и клиент, и оператор, но которые не несут предмета разговора. Категории: местоимения,
 * союзы, предлоги и послелоги, частицы, формулы вежливости, вспомогательные и модальные глаголы.
 * Пополняется только словами этих категорий.
 */
const STOP_WORDS = new Set(
  [
    // ru: местоимения, вопросительные слова
    "ваша", "ваше", "вашего", "вашей", "ваши", "вашу", "вами", "меня", "этот", "этого", "этой", "того", "какой",
    "какая", "какое", "какие", "каком", "какого", "который", "которые", "сколько", "куда", "почему", "зачем",
    // ru: союзы, предлоги, частицы, наречия-связки
    "если", "когда", "чтобы", "тоже", "также", "либо", "после", "перед", "через", "только", "сейчас", "потом",
    "здесь", "тогда", "есть", "будет", "было", "была", "были",
    // ru: вежливость, модальные слова
    "пожалуйста", "спасибо", "здравствуйте", "можно", "нужно", "нужен", "нужна", "надо", "могу", "можете",
    "подскажите", "скажите", "назовите",
    // kk: местоимения, вопросительные слова
    "сізге", "сіздің", "сізді", "сізбен", "біздің", "бізге", "маған", "менің", "оның", "қандай", "қанша",
    "қашан", "неге", "нені", "неше",
    // kk: шылау и послелоги, частицы
    "бойынша", "туралы", "үшін", "және", "немесе", "бірақ", "әлде", "қазір", "кейін", "дейін",
    // kk: вежливость, вспомогательные глаголы
    "рақмет", "сәлеметсіз", "беріңізші", "айтыңызшы", "айтып", "жіберіңізші", "керек", "болады", "болды",
    "болса", "келеді", "жатыр",
  ].map(fold),
);

type Side = "client" | "operator" | "meta";
type Lang = "ru" | "kk";

interface Occurrence {
  word: string;
  /** Первое слово предложения: заглавная буква здесь ничего не говорит об имени собственном. */
  sentenceStart: boolean;
  scenarioIds: string[];
  side: Side;
  lang: Lang | null;
}

interface Entry {
  kind: "acronym" | "word";
  key: string;
  /** Словоформа в нижнем регистре → число вхождений. */
  forms: Map<string, number>;
  /** Словоформы, хотя бы раз записанные строчными. */
  lowercaseForms: Set<string>;
  /** Словоформы, записанные с заглавной не в начале предложения. */
  midSentenceCapitalForms: Set<string>;
  clientFrequency: number;
  sides: Set<Side>;
  langs: Set<Lang>;
  scenarios: Set<string>;
  slotValues: Set<string>;
}

/** Все тексты набора с пометкой: чья реплика, какой язык, к каким сценариям относится. */
function* textsOf(kit: Kit): Generator<{ text: string; side: Side; lang: Lang | null; scenarioIds: string[] }> {
  const slotUsers = new Map<string, string[]>();
  for (const s of kit.scenarios) {
    for (const slot of [...(s.slots?.required ?? []), ...(s.slots?.optional ?? [])]) {
      slotUsers.set(slot, [...(slotUsers.get(slot) ?? []), s.scenario_id]);
    }
  }
  for (const s of kit.scenarios) {
    const ids = [s.scenario_id];
    yield { text: s.name, side: "meta", lang: null, scenarioIds: ids };
    yield { text: s.description ?? "", side: "meta", lang: null, scenarioIds: ids };
    for (const lang of ["ru", "kk"] as const) {
      for (const text of s.examples[lang] ?? []) yield { text, side: "client", lang, scenarioIds: ids };
      for (const text of Object.values(s.responses?.[lang] ?? {})) yield { text, side: "operator", lang, scenarioIds: ids };
    }
  }
  for (const slot of kit.slots) {
    const ids = slotUsers.get(slot.name) ?? [];
    yield { text: slot.description ?? "", side: "meta", lang: null, scenarioIds: ids };
    for (const lang of ["ru", "kk"] as const) {
      yield { text: slot.prompt?.[lang] ?? "", side: "operator", lang, scenarioIds: ids };
    }
  }
}

function occurrencesOf(kit: Kit): Occurrence[] {
  const out: Occurrence[] = [];
  for (const { text, side, lang, scenarioIds } of textsOf(kit)) {
    for (const sentence of text.split(/(?<=[.?!])\s+/)) {
      // дефис делит слово на части: «ЖСН-іңізді» даёт аббревиатуру ЖСН
      words(sentence)
        .flatMap((w) => w.split("-"))
        .forEach((word, index) => {
          if (/^\p{L}+$/u.test(word)) out.push({ word, sentenceStart: index === 0, scenarioIds, side, lang });
        });
    }
  }
  return out;
}

function newEntry(kind: Entry["kind"], key: string): Entry {
  return {
    kind,
    key,
    forms: new Map(),
    lowercaseForms: new Set(),
    midSentenceCapitalForms: new Set(),
    clientFrequency: 0,
    sides: new Set(),
    langs: new Set(),
    scenarios: new Set(),
    slotValues: new Set(),
  };
}

function record(entry: Entry, occ: Occurrence, form: string): void {
  entry.forms.set(form, (entry.forms.get(form) ?? 0) + 1);
  if (occ.word === occ.word.toLowerCase()) entry.lowercaseForms.add(form);
  else if (!occ.sentenceStart) entry.midSentenceCapitalForms.add(form);
  entry.sides.add(occ.side);
  if (occ.lang) entry.langs.add(occ.lang);
  if (occ.side !== "client") return;
  entry.clientFrequency += 1;
  for (const id of occ.scenarioIds) entry.scenarios.add(id);
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Основная форма: самая частая в данных, при равенстве — самая короткая, затем по алфавиту.
 * Самая частая, а не самая короткая: основа из 5 букв иногда сводит вместе разные слова
 * (сақтандыру и сақтаңыз), и частота выбирает то, о котором говорят чаще.
 * Имя собственное сохраняет заглавную букву: Алматы — ни разу не записано строчными и хотя бы раз
 * записано с заглавной не в начале предложения.
 */
function canonicalForm(entry: Entry): string {
  if (entry.kind === "acronym") return [...entry.forms.keys()].find(isAcronym) ?? entry.key.toUpperCase();
  const forms = [...entry.forms.entries()].map(([form, count]) => ({ form, count }));
  forms.sort((a, b) => b.count - a.count || a.form.length - b.form.length || byCodePoint(a.form, b.form));
  const form = forms[0]?.form ?? entry.key;
  const proper = !entry.lowercaseForms.has(form) && entry.midSentenceCapitalForms.has(form);
  return proper ? form.charAt(0).toUpperCase() + form.slice(1) : form;
}

export function buildGlossary(kit: Kit): Glossary {
  const occurrences = occurrencesOf(kit);

  // R1: аббревиатуры в репликах клиента и оператора
  const acronyms = new Map<string, Entry>();
  for (const occ of occurrences) {
    if (occ.side !== "meta" && isAcronym(occ.word)) {
      const key = fold(occ.word);
      if (!acronyms.has(key)) acronyms.set(key, newEntry("acronym", key));
    }
  }

  // R1 + R2: подсчёт вхождений; латиница из названий и описаний — только покрытие аббревиатур
  const stems = new Map<string, Entry>();
  for (const occ of occurrences) {
    if (occ.side === "meta") {
      if (isAcronym(occ.word)) {
        const entry = acronyms.get(transliterate(occ.word));
        if (entry) for (const id of occ.scenarioIds) entry.scenarios.add(id);
      }
      continue;
    }
    const folded = fold(occ.word);
    const acronym = acronyms.get(folded);
    if (acronym) {
      record(acronym, occ, isAcronym(occ.word) ? occ.word : folded);
      continue;
    }
    const key = stem(folded);
    const entry = stems.get(key) ?? newEntry("word", key);
    stems.set(key, entry);
    record(entry, occ, folded);
  }

  const isDomainWord = (entry: Entry, word: string): boolean =>
    word.length >= MIN_WORD_LENGTH &&
    !STOP_WORDS.has(word) &&
    entry.clientFrequency >= MIN_CLIENT_FREQUENCY &&
    entry.sides.has("client") &&
    entry.sides.has("operator");

  const selected = new Map<string, Entry>();
  for (const [key, entry] of acronyms) selected.set(`a:${key}`, entry);
  for (const [key, entry] of stems) if (isDomainWord(entry, fold(canonicalForm(entry)))) selected.set(`w:${key}`, entry);

  // R4: значения enum-слотов
  for (const slot of [...kit.slots].sort((a, b) => byCodePoint(a.name, b.name))) {
    if (slot.type !== "enum") continue;
    for (const value of slot.values ?? []) {
      if (typeof value !== "string") continue;
      const spoken = transliterate(value);
      const entry = acronyms.get(spoken) ?? stems.get(stem(spoken));
      if (!entry) continue;
      entry.slotValues.add(`${slot.name}=${value}`);
      selected.set(entry.kind === "acronym" ? `a:${entry.key}` : `w:${entry.key}`, entry);
    }
  }

  const terms: Term[] = [...selected.values()]
    .filter((entry) => entry.langs.size > 0)
    .map((entry) => ({
      term: canonicalForm(entry),
      kind: entry.kind,
      lang: entry.langs.size > 1 ? ("shared" as const) : entry.langs.has("ru") ? ("ru" as const) : ("kk" as const),
      coverage: entry.scenarios.size,
      frequency: entry.clientFrequency,
      scenarios: [...entry.scenarios].sort(byCodePoint),
      forms: [...entry.forms.keys()].sort(byCodePoint),
      slotValues: [...entry.slotValues].sort(byCodePoint),
    }))
    .sort((a, b) => b.coverage - a.coverage || b.frequency - a.frequency || byCodePoint(a.term, b.term));

  const listOf = (lang: Term["lang"]) => terms.filter((t) => t.lang === lang).map((t) => t.term);

  return {
    version: 1,
    source: { scenarios: kit.scenarios.length, slots: kit.slots.length },
    terms,
    ru: listOf("ru"),
    kk: listOf("kk"),
    shared: listOf("shared"),
    identifiers: identifiersOf(kit),
    phrases: phrasesOf(kit, terms),
  };
}

// ---------- R5: форматы номеров ----------

/**
 * Разбор pattern слота в образцы номеров. Поддерживается узкий класс шаблонов:
 * литералы, группа альтернатив (A|B), \d{n}, [A-Z]{n} — этого хватает для номеров полиса и заявления.
 * Шаблон с другими конструкциями пропускается целиком.
 */
function expandPattern(pattern: string): string[] | null {
  const body = pattern.replace(/^\^/, "").replace(/\$$/, "");
  const TOKEN = /\(([A-Za-z0-9|]+)\)|\\d\{(\d+)\}|\\d|\[A-Z\]\{(\d+)(?:,\d+)?\}|([A-Za-z0-9-])/y;
  let variants = [""];
  let prefixDone = false;
  let pos = 0;
  while (pos < body.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(body);
    if (!m) return null;
    pos = TOKEN.lastIndex;
    const [, group, digits, letters, literal] = m;
    let parts: string[];
    if (group !== undefined) parts = group.split("|");
    else if (literal !== undefined) parts = [literal];
    else {
      const n = Number(digits ?? letters ?? 1);
      parts = [letters !== undefined ? "ABCDEFGHIJ".slice(0, n) : "1234567890".repeat(2).slice(0, n)];
      if (!prefixDone) variants = variants.map((v) => `${v}\u0000`);
      prefixDone = true;
    }
    variants = variants.flatMap((v) => parts.map((p) => v + p));
  }
  return variants;
}

function identifiersOf(kit: Kit): Identifier[] {
  const usage = new Map<string, number>();
  for (const s of kit.scenarios) {
    for (const slot of [...(s.slots?.required ?? []), ...(s.slots?.optional ?? [])]) {
      usage.set(slot, (usage.get(slot) ?? 0) + 1);
    }
  }
  const slots = [...kit.slots]
    .filter((slot) => slot.pattern)
    .sort((a, b) => (usage.get(b.name) ?? 0) - (usage.get(a.name) ?? 0) || byCodePoint(a.name, b.name));
  const out: Identifier[] = [];
  for (const slot of slots) {
    for (const variant of expandPattern(slot.pattern ?? "") ?? []) {
      const [prefix = "", rest = ""] = variant.split("\u0000");
      const keyword = prefix.replace(/-+$/, "");
      if (!/[A-Za-z]{2,}/.test(keyword)) continue;
      out.push({ slot: slot.name, keyword, sample: prefix + rest });
    }
  }
  return out;
}

// ---------- фразы клиента для подсказки ----------

/**
 * Для каждого термина — самая короткая реплика клиента с ним на ru и на kk. Аббревиатура во фразе
 * записывается как в словаре («каско» → «КАСКО»): по фразе модель распознавания учится написанию.
 */
function phrasesOf(kit: Kit, terms: Term[]): Phrase[] {
  const acronyms = new Map(terms.filter((t) => t.kind === "acronym").map((t) => [fold(t.term), t.term]));
  const canonical = (text: string) => text.replace(/\p{L}+/gu, (w) => acronyms.get(fold(w)) ?? w);
  const candidates: Phrase[] = [];
  for (const s of kit.scenarios) {
    for (const lang of ["ru", "kk"] as const) {
      for (const raw of s.examples[lang] ?? []) {
        const text = canonical(raw);
        candidates.push({ lang, text, scenarioId: s.scenario_id, terms: findTerms(text, terms) });
      }
    }
  }
  candidates.sort((a, b) => a.text.length - b.text.length || byCodePoint(a.text, b.text));

  const chosen = new Map<string, Phrase>();
  for (const term of terms) {
    for (const lang of ["ru", "kk"] as const) {
      const phrase = candidates.find((p) => p.lang === lang && p.terms.includes(term.term));
      if (phrase && !chosen.has(phrase.text)) chosen.set(phrase.text, phrase);
    }
  }
  return [...chosen.values()];
}
