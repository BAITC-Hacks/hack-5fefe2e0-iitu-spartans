import { describe, expect, it } from "vitest";
import { findTerms, normalizeWords, wordErrorRate } from "./metrics";

describe("normalizeWords — нормализация для сравнения транскриптов", () => {
  it("нижний регистр, ё как е, без пунктуации, дефис внутри слова сохраняется", () => {
    expect(normalizeWords("Ещё раз: ОГПО, по-казахски — Сақтандыру!")).toEqual([
      "еще",
      "раз",
      "огпо",
      "по-казахски",
      "сақтандыру",
    ]);
  });
});

describe("wordErrorRate — WER по словам", () => {
  it("ноль для совпадения с точностью до регистра и пунктуации", () => {
    expect(wordErrorRate("Сколько стоит ОГПО?", "сколько стоит огпо")).toBe(0);
  });

  it("считает замены, вставки и удаления относительно эталона", () => {
    // 1 замена (огпо → агпа) из 3 слов
    expect(wordErrorRate("сколько стоит огпо", "сколько стоит агпа")).toBeCloseTo(1 / 3);
    // 1 удаление + 1 вставка
    expect(wordErrorRate("полис каско готов", "полис готов вот")).toBeCloseTo(2 / 3);
  });
});

describe("findTerms — какие термины словаря присутствуют в тексте", () => {
  const terms = [
    { term: "ОГПО", kind: "acronym" as const, forms: ["ОГПО", "огпо"] },
    { term: "полис", kind: "word" as const, forms: ["полис", "полиса", "полисім"] },
  ];

  it("аббревиатура — точное слово без учёта регистра", () => {
    expect(findTerms("Хочу огпо продлить", terms)).toEqual(["ОГПО"]);
    expect(findTerms("Хочу OGPO продлить", terms)).toEqual([]);
    expect(findTerms("Хочу агпо продлить", terms)).toEqual([]);
  });

  it("слово — любая словоформа с той же основой", () => {
    expect(findTerms("Действует ли полисім?", terms)).toEqual(["полис"]);
    expect(findTerms("номер полису", terms)).toEqual(["полис"]);
    expect(findTerms("номер полюса", terms)).toEqual([]);
  });
});
