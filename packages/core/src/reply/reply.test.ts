import { describe, expect, it } from "vitest";
import type { Catalog } from "../router/catalog";
import { buildReply, replyLanguage } from "./build-reply";
import { demoDecision } from "./demo-router";

// Фразы — из responses сценариев и response системных намерений стартового набора (scenarios.json).
const CATALOG: Catalog = {
  scenarios: [
    {
      scenario_id: "SC30",
      name: "Payment taken, policy not issued",
      description: "Client paid but the policy was not issued.",
      not_this_if: [],
      priority: "high",
      examples: { ru: ["Деньги списались, а полис не пришёл"], kk: ["Ақша шешілді, полис келмеді"] },
      responses: {
        ru: { opening: "Разберёмся. Когда был платёж и на какую сумму?", closing: "" },
        kk: { opening: "Анықтап көрейік. Төлем қашан және қанша сомаға болды?", closing: "" },
      },
    },
    {
      scenario_id: "SC29",
      name: "Update contact details",
      description: "Client wants to update phone, email or address.",
      not_this_if: [],
      priority: "normal",
      examples: { ru: ["Хочу поменять адрес"], kk: ["Мекенжайды өзгерткім келеді"] },
      responses: {
        ru: { opening: "Помогу обновить данные. Что меняем?", closing: "" },
        kk: { opening: "Деректерді жаңартуға көмектесемін. Нені өзгертеміз?", closing: "" },
      },
    },
  ],
  system_intents: [
    {
      id: "SYS_UNCLEAR",
      description: "Unclear",
      response: { ru: "Уточните, пожалуйста: вы хотите {option_a} или {option_b}?", kk: "Нақтылап жіберіңізші: {option_a} керек пе, әлде {option_b} ме?" },
    },
    { id: "SYS_OUT_OF_SCOPE", description: "Out of scope", response: { ru: "С этим я не помогу.", kk: "Бұған көмектесе алмаймын." } },
  ],
};
const LABELS = { ru: { SC30: "разобраться с оплатой без полиса", SC29: "обновить контактные данные" }, kk: { SC30: "төлем мен полисті анықтау", SC29: "байланыс деректерін жаңарту" } };

describe("replyLanguage — язык ответа", () => {
  it("отвечает на казахском, если клиент говорит на казахском, иначе на русском", () => {
    expect(replyLanguage("kk")).toBe("kk");
    expect(replyLanguage("ru")).toBe("ru");
    expect(replyLanguage("mixed")).toBe("ru");
  });
});

describe("buildReply — ответ робота по действию политики и данным набора", () => {
  it("запуск сценария — начальная фраза сценария на языке клиента", () => {
    expect(buildReply({ kind: "run", queue: ["SC30"] }, "kk", CATALOG, LABELS)).toBe("Анықтап көрейік. Төлем қашан және қанша сомаға болды?");
  });

  it("несколько сценариев — начинает с первого и обещает вернуться ко второму", () => {
    const text = buildReply({ kind: "run", queue: ["SC30", "SC29"] }, "ru", CATALOG, LABELS);
    expect(text.startsWith("Разберёмся.")).toBe(true);
    expect(text).toContain("обновить контактные данные");
  });

  it("уточнение — шаблон SYS_UNCLEAR с двумя вариантами", () => {
    expect(buildReply({ kind: "clarify", options: ["SC30", "SC29"] }, "ru", CATALOG, LABELS)).toBe(
      "Уточните, пожалуйста: вы хотите разобраться с оплатой без полиса или обновить контактные данные?",
    );
  });

  it("непонятная реплика без вариантов (например, приветствие) — открытый вопрос без полей шаблона", () => {
    // Живой прогон: на «Здравствуйте.» робот произнёс шаблон SYS_UNCLEAR с {option_a} и {option_b} как есть.
    for (const lang of ["ru", "kk"] as const) {
      const text = buildReply({ kind: "run", queue: ["SYS_UNCLEAR"] }, lang, CATALOG, LABELS);
      expect(text).not.toMatch(/[{}]/);
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it("системное намерение — фраза из набора", () => {
    expect(buildReply({ kind: "run", queue: ["SYS_OUT_OF_SCOPE"] }, "ru", CATALOG, LABELS)).toBe("С этим я не помогу.");
  });

  it("передача оператору — обещает не заставлять повторять", () => {
    expect(buildReply({ kind: "handoff", reason: "client_request" }, "ru", CATALOG, LABELS)).toMatch(/оператор/);
  });
});

describe("demoDecision — режим проверки без ключа модели", () => {
  it("находит сценарий по словам из примеров каталога и помечает решение как демо", () => {
    const decision = demoDecision(CATALOG, "у меня деньги списались а полис не пришёл");
    expect(decision.scenarios[0]?.scenario_id).toBe("SC30");
    expect(decision.scenarios[0]?.reason).toMatch(/демо/);
  });

  it("при отсутствии совпадений возвращает SYS_UNCLEAR с низкой уверенностью", () => {
    const decision = demoDecision(CATALOG, "абракадабра");
    expect(decision.scenarios[0]?.scenario_id).toBe("SYS_UNCLEAR");
    expect(decision.scenarios[0]?.confidence).toBeLessThan(0.45);
  });

  it("определяет казахский по буквам казахского алфавита", () => {
    expect(demoDecision(CATALOG, "Ақша шешілді, полис келмеді").language).toBe("kk");
  });
});
