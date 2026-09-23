import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGlossary, GlossarySchema, parseKit } from "./glossary";

// Артефакт, который подключает голосовой конвейер: собирается `pnpm glossary:build` из стартового набора.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT = path.join(HERE, "stt-glossary.json");
const KIT_DIR = path.resolve(process.env.KIT_DIR ?? path.join(HERE, "../../../../data/kit"));
const kitAvailable = existsSync(path.join(KIT_DIR, "scenarios.json")) && existsSync(path.join(KIT_DIR, "slots.json"));

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const artifact = GlossarySchema.parse(readJson(ARTIFACT));

describe("stt-glossary.json — словарь из стартового набора", () => {
  it("содержит продуктовые термины ОГПО, КАСКО, ДМС и слова полис, сақтандыру", () => {
    const names = artifact.terms.map((t) => t.term);
    for (const term of ["ОГПО", "КАСКО", "ДМС", "полис", "сақтандыру"]) expect(names, term).toContain(term);
  });

  it("продуктовые аббревиатуры общие для ru и kk и связаны со слотом product_type", () => {
    for (const term of ["ОГПО", "КАСКО", "ДМС"]) {
      const entry = artifact.terms.find((t) => t.term === term);
      expect(entry?.lang, term).toBe("shared");
      expect(entry?.slotValues.some((v) => v.startsWith("product_type=")), term).toBe(true);
    }
  });

  it.skipIf(!kitAvailable)(`соответствует данным набора в ${KIT_DIR} (иначе: pnpm glossary:build)`, () => {
    const fresh = buildGlossary(parseKit(readJson(path.join(KIT_DIR, "scenarios.json")), readJson(path.join(KIT_DIR, "slots.json"))));
    const { sha256: _ignored, ...source } = artifact.source;
    expect({ ...artifact, source }).toEqual(fresh);
  });
});
