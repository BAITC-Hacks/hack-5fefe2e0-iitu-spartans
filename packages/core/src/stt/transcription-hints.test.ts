import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGlossary, parseKit } from "./glossary";
import { buildTranscriptionHints, STT_MODELS, toTranscriptionFormFields } from "./transcription-hints";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mini-kit");
const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8"));
const glossary = buildGlossary(parseKit(readJson("scenarios.json"), readJson("slots.json")));

const KAZAKH_LETTERS = /[әғқңөұүһі]/i;

describe("buildTranscriptionHints — подсказка для OpenAI speech-to-text", () => {
  it("gpt-transcribe: оба языка через languages, термины через keywords, без жёсткого language", () => {
    const hints = buildTranscriptionHints(glossary, { model: "gpt-transcribe" });
    expect(hints.languages).toEqual(["ru", "kk"]);
    expect(hints).not.toHaveProperty("language");
    expect(hints.keywords?.slice(0, 3)).toEqual(expect.arrayContaining(["ОГПО", "КАСКО", "ДМС"]));
    expect(hints.keywords).toContain("полис");
  });

  it("gpt-4o-transcribe: languages и keywords не поддерживаются — оба языка и термины задаются подсказкой", () => {
    const hints = buildTranscriptionHints(glossary, { model: "gpt-4o-transcribe" });
    expect(hints).not.toHaveProperty("language");
    expect(hints).not.toHaveProperty("languages");
    expect(hints).not.toHaveProperty("keywords");
    for (const term of ["ОГПО", "КАСКО", "ДМС"]) expect(hints.prompt, term).toContain(term);
    expect(hints.prompt).toMatch(KAZAKH_LETTERS);
    expect(hints.prompt).toMatch(/Сколько|Хочу|Посчитайте/);
  });

  it("подсказка состоит из фраз набора, а не только из списка слов", () => {
    const hints = buildTranscriptionHints(glossary, { model: "gpt-4o-transcribe" });
    const phraseTexts = glossary.phrases.map((p) => p.text);
    expect(phraseTexts.some((text) => hints.prompt.includes(text))).toBe(true);
  });

  it("укладывается в бюджет модели и в заданный вручную", () => {
    for (const model of STT_MODELS) {
      const hints = buildTranscriptionHints(glossary, { model });
      expect(hints.prompt.length, model).toBeLessThanOrEqual(buildTranscriptionHints.budget(model).promptChars);
    }
    const tiny = buildTranscriptionHints(glossary, { model: "gpt-transcribe", promptChars: 40, maxKeywords: 2 });
    expect(tiny.prompt.length).toBeLessThanOrEqual(40);
    expect(tiny.keywords).toHaveLength(2);
  });

  it("whisper-1 получает самую короткую подсказку (лимит 224 токена)", () => {
    const whisper = buildTranscriptionHints(glossary, { model: "whisper-1" });
    const gpt = buildTranscriptionHints(glossary, { model: "gpt-4o-transcribe" });
    expect(whisper.prompt.length).toBeLessThanOrEqual(gpt.prompt.length);
    expect(whisper.prompt).toContain("ОГПО");
  });

  it("ключевые слова без скобок и переводов строки (требование API)", () => {
    const hints = buildTranscriptionHints(glossary, { model: "gpt-live-transcribe" });
    for (const keyword of hints.keywords ?? []) expect(keyword).not.toMatch(/[()[\]{}\n\r]/);
  });

  it("детерминирован", () => {
    const a = buildTranscriptionHints(glossary, { model: "gpt-transcribe" });
    const b = buildTranscriptionHints(glossary, { model: "gpt-transcribe" });
    expect(a).toEqual(b);
  });
});

describe("toTranscriptionFormFields — поля multipart для POST /v1/audio/transcriptions", () => {
  it("передаёт массивы как повторяющиеся поля с []", () => {
    const hints = buildTranscriptionHints(glossary, { model: "gpt-transcribe", maxKeywords: 2 });
    const fields = toTranscriptionFormFields(hints);
    expect(fields).toContainEqual(["model", "gpt-transcribe"]);
    expect(fields.filter(([name]) => name === "languages[]")).toEqual([
      ["languages[]", "ru"],
      ["languages[]", "kk"],
    ]);
    expect(fields.filter(([name]) => name === "keywords[]")).toHaveLength(2);
    expect(fields.find(([name]) => name === "prompt")?.[1]).toBe(hints.prompt);
  });

  it("без подсказки — только модель", () => {
    expect(toTranscriptionFormFields({ model: "gpt-transcribe" })).toEqual([["model", "gpt-transcribe"]]);
  });
});
