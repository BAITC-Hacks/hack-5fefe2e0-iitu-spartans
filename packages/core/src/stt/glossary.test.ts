import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGlossary, GlossarySchema, parseKit, transliterate, type Kit } from "./glossary";

// Фикстура повторяет формат scenarios.json и slots.json стартового набора: 4 сценария, 6 слотов.
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mini-kit");
const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8"));
const loadFixture = (): Kit => parseKit(readJson("scenarios.json"), readJson("slots.json"));

const termNames = (kit: Kit) => buildGlossary(kit).terms.map((t) => t.term);
const findTerm = (kit: Kit, term: string) => buildGlossary(kit).terms.find((t) => t.term === term);

describe("parseKit — чтение данных набора", () => {
  it("читает сценарии и слоты в формате стартового набора", () => {
    const kit = loadFixture();
    expect(kit.scenarios.map((s) => s.scenario_id)).toEqual(["SC01", "SC03", "SC21", "SC25"]);
    expect(kit.slots.map((s) => s.name)).toContain("product_type");
  });

  it("отклоняет данные не того формата с понятной ошибкой", () => {
    expect(() => parseKit({ scenarios: "нет" }, { slots: [] })).toThrow(/scenarios/);
  });
});

describe("buildGlossary — термины из данных набора", () => {
  it("находит аббревиатуры продуктов ОГПО, КАСКО, ДМС", () => {
    const names = termNames(loadFixture());
    for (const term of ["ОГПО", "КАСКО", "ДМС"]) expect(names, term).toContain(term);
    expect(findTerm(loadFixture(), "КАСКО")?.kind).toBe("acronym");
  });

  it("сводит написание строчными («каско») к аббревиатуре", () => {
    const kasko = findTerm(loadFixture(), "КАСКО");
    // 3 вхождения КАСКО в examples + «каско» строчными = 4
    expect(kasko?.frequency).toBe(4);
    expect(termNames(loadFixture())).not.toContain("каско");
  });

  it("находит доменные слова: полис (общий для ru и kk) и сақтандыру (kk)", () => {
    const glossary = buildGlossary(loadFixture());
    expect(glossary.shared).toContain("полис");
    expect(glossary.kk).toContain("сақтандыру");
    expect(glossary.ru).not.toContain("сақтандыру");
  });

  it("сводит словоформы к самой частой: полис, а не полиса или полисі", () => {
    const polis = findTerm(loadFixture(), "полис");
    expect(polis?.forms).toEqual(expect.arrayContaining(["полис", "полиса", "полисі"]));
  });

  it("имя собственное сохраняет заглавную букву, первое слово предложения — нет", () => {
    const names = termNames(loadFixture());
    expect(names).toContain("Алматы");
    // «Сақтандыру полисін…» начинает реплику, но в остальных местах слово строчное
    expect(names).toContain("сақтандыру");
    expect(names).not.toContain("Сақтандыру");
  });

  it("не включает служебные слова и слова, которые говорит только клиент", () => {
    const names = termNames(loadFixture());
    for (const word of ["пожалуйста", "хочу", "можно", "бойынша"]) expect(names, word).not.toContain(word);
  });

  it("связывает термин со значением enum-слота через транслитерацию", () => {
    expect(findTerm(loadFixture(), "ОГПО")?.slotValues).toContain("product_type=ogpo");
    expect(findTerm(loadFixture(), "ДМС")?.slotValues).toContain("product_type=dms");
    // travel не встречается в текстах набора — значение слота не становится термином
    expect(termNames(loadFixture()).some((t) => t.toLowerCase().startsWith("травел"))).toBe(false);
  });

  it("считает покрытие по репликам клиента и сортирует термины по важности", () => {
    const glossary = buildGlossary(loadFixture());
    expect(glossary.terms.find((t) => t.term === "сақтандыру")?.scenarios).toEqual(["SC01", "SC03", "SC21", "SC25"]);
    // «полис» оператор говорит во всех сценариях, клиент — только в SC25
    expect(glossary.terms.find((t) => t.term === "полис")?.scenarios).toEqual(["SC25"]);
    const scores = glossary.terms.map((t) => [t.coverage, t.frequency] as const);
    for (let i = 1; i < scores.length; i++) {
      const [prevCov, prevFreq] = scores[i - 1] ?? [0, 0];
      const [cov, freq] = scores[i] ?? [0, 0];
      expect(prevCov > cov || (prevCov === cov && prevFreq >= freq), `позиция ${i}`).toBe(true);
    }
  });

  it("выводит форматы номеров из pattern слотов: префиксы полиса и заявления", () => {
    const { identifiers } = buildGlossary(loadFixture());
    expect(identifiers.map((i) => i.keyword)).toEqual(["SQ-OGPO", "SQ-CASCO", "SQ-DMS", "CL"]);
    expect(identifiers[0]).toMatchObject({ slot: "policy_number", sample: "SQ-OGPO-123456" });
    // телефон (+7…) — без буквенного префикса, это не термин
    expect(identifiers.some((i) => i.slot === "phone")).toBe(false);
  });

  it("собирает короткие фразы клиента с терминами на ru и kk", () => {
    const { phrases } = buildGlossary(loadFixture());
    const ogpo = phrases.filter((p) => p.terms.includes("ОГПО"));
    expect(new Set(ogpo.map((p) => p.lang))).toEqual(new Set(["kk", "ru"]));
    // из двух русских примеров с ОГПО берётся более короткий
    expect(ogpo.map((p) => p.text)).toContain("Сколько стоит ОГПО в Алматы?");
  });

  it("во фразах аббревиатура записана как в словаре: «каско» становится «КАСКО»", () => {
    const { phrases } = buildGlossary(loadFixture());
    const texts = phrases.map((p) => p.text);
    expect(texts).toContain("Интересует КАСКО с франшизой");
    expect(texts.some((t) => t.includes("каско"))).toBe(false);
  });

  it("детерминирован: порядок сценариев и слотов во входе не влияет на результат", () => {
    const kit = loadFixture();
    const shuffled: Kit = { scenarios: [...kit.scenarios].reverse(), slots: [...kit.slots].reverse() };
    expect(JSON.stringify(buildGlossary(shuffled))).toBe(JSON.stringify(buildGlossary(kit)));
  });

  it("соответствует схеме артефакта", () => {
    expect(GlossarySchema.safeParse(buildGlossary(loadFixture())).success).toBe(true);
  });
});

describe("buildGlossary — словарь следует за данными", () => {
  it("новый сценарий с новой аббревиатурой добавляет термин", () => {
    const kit = loadFixture();
    const before = termNames(kit);
    expect(before).not.toContain("НС");
    kit.scenarios.push({
      scenario_id: "SC08",
      name: "Accident insurance consultation",
      description: "Client asks about NS.",
      examples: {
        ru: ["Расскажите про НС для ребёнка", "Сколько стоит страховка НС?"],
        kk: ["НС сақтандыру туралы айтыңызшы"],
      },
      responses: {
        ru: { opening: "Полис НС покрывает травмы." },
        kk: { opening: "НС полисі жарақатты өтейді." },
      },
    });
    expect(termNames(kit)).toContain("НС");
  });

  it("удаление сценариев убирает термин, который встречался только в них", () => {
    const kit = loadFixture();
    kit.scenarios = kit.scenarios.filter((s) => s.scenario_id !== "SC21");
    expect(termNames(kit)).not.toContain("ДМС");
  });
});

describe("transliterate — латиница значений слотов в кириллицу", () => {
  it("переводит коды продуктов и городов", () => {
    expect(transliterate("ogpo")).toBe("огпо");
    expect(transliterate("casco")).toBe("каско");
    expect(transliterate("Shymkent")).toBe("шымкент");
    expect(transliterate("almaty")).toBe("алматы");
  });
});
