/**
 * Текстовые правила словаря терминов: разбиение на слова, основа слова, транслитерация.
 * Общие для сборщика словаря (glossary.ts) и метрик распознавания (metrics.ts): одно и то же слово
 * должно считаться одинаково и при сборке словаря, и при проверке транскрипта.
 */

/** Слово: буквы и цифры любых алфавитов, дефис внутри слова сохраняется («по-казахски»). */
const WORD = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;

/** Слова текста в исходном регистре. */
export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

/** Приведение к виду для сравнения: нижний регистр, «ё» как «е». */
export function fold(word: string): string {
  return word.toLowerCase().replaceAll("ё", "е");
}

/**
 * Длина основы слова. Русский и казахский — языки с богатой словоизменительной морфологией
 * (полис — полиса — полисі — полисім, сақтандыру — сақтандыруы). Первые 5 букв — грубая, но
 * детерминированная основа: словоформы одного слова сходятся, разные слова почти не сливаются.
 * Слова короче 5 букв сравниваются целиком.
 */
export const STEM_LENGTH = 5;

export function stem(word: string): string {
  return fold(word).slice(0, STEM_LENGTH);
}

/** Аббревиатура: 2–6 букв, все заглавные (ОГПО, КАСКО, ДМС, ИИН, ЖСН). */
export function isAcronym(word: string): boolean {
  return /^\p{Lu}{2,6}$/u.test(word);
}

/**
 * Латиница → кириллица по звукам. Нужна, чтобы связать коды из данных набора (значения enum-слотов
 * ogpo, casco, almaty; латинские аббревиатуры в названиях сценариев OGPO, DMS) с тем, как те же слова
 * записаны в репликах (ОГПО, КАСКО, Алматы). Сначала буквосочетания, затем одиночные буквы.
 */
const DIGRAPHS: Array<[string, string]> = [
  ["sh", "ш"],
  ["ch", "ч"],
  ["zh", "ж"],
  ["kh", "х"],
];
const LETTERS: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "ж", k: "к", l: "л", m: "м",
  n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс", y: "ы", z: "з",
};

export function transliterate(latin: string): string {
  let rest = latin.toLowerCase();
  let out = "";
  while (rest.length > 0) {
    const digraph = DIGRAPHS.find(([from]) => rest.startsWith(from));
    if (digraph) {
      out += digraph[1];
      rest = rest.slice(digraph[0].length);
      continue;
    }
    const ch = rest[0] ?? "";
    out += LETTERS[ch] ?? ch;
    rest = rest.slice(1);
  }
  return out;
}

/** Минимальная длина доменного слова: короче — служебные слова и союзы. */
export const MIN_WORD_LENGTH = 4;

/**
 * Термины, которые есть в тексте. Аббревиатура засчитывается только точным словом без учёта регистра:
 * «агпо» или латинское «OGPO» вместо ОГПО — искажение. Слово — любой словоформой с той же основой.
 */
export function findTerms(text: string, terms: ReadonlyArray<{ term: string; kind: "acronym" | "word" }>): string[] {
  const tokens = words(text).flatMap((w) => w.split("-")).map(fold);
  const tokenSet = new Set(tokens);
  const stems = new Set(tokens.filter((t) => t.length >= MIN_WORD_LENGTH).map(stem));
  return terms
    .filter((t) => (t.kind === "acronym" ? tokenSet.has(fold(t.term)) : stems.has(stem(t.term))))
    .map((t) => t.term);
}
