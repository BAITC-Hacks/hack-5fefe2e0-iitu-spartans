import { describe, expect, it } from "vitest";
import { parseRouteDecision, RouteDecisionSchema } from "./route-decision";

// Эталон — пример формата ответа LLM-маршрутизатора из README стартового набора организаторов
// (раздел «Уровень 2 — LLM-маршрутизатор»).
const KIT_EXAMPLE = {
  scenarios: [
    { scenario_id: "SC30", confidence: 0.86, reason: "money charged, policy not issued" },
    { scenario_id: "SC29", confidence: 0.78, reason: "moved, wants to change address" },
  ],
  alternatives: [{ scenario_id: "SC26", confidence: 0.31 }],
  language: "ru",
  slots: { payment_date: "2026-09-30" },
  is_continuation: false,
};

const withPatch = (patch: Record<string, unknown>) => ({ ...KIT_EXAMPLE, ...patch });

describe("RouteDecisionSchema — контракт ответа LLM-маршрутизатора", () => {
  it("принимает пример из README стартового набора", () => {
    expect(RouteDecisionSchema.safeParse(KIT_EXAMPLE).success).toBe(true);
  });

  it("принимает системные намерения SYS_UNCLEAR, SYS_OUT_OF_SCOPE, SYS_GOODBYE", () => {
    for (const id of ["SYS_UNCLEAR", "SYS_OUT_OF_SCOPE", "SYS_GOODBYE"]) {
      const decision = withPatch({ scenarios: [{ scenario_id: id, confidence: 0.9, reason: "system intent" }] });
      expect(RouteDecisionSchema.safeParse(decision).success, id).toBe(true);
    }
  });

  it("принимает смешанную речь как язык mixed и казахский как kk", () => {
    expect(RouteDecisionSchema.safeParse(withPatch({ language: "mixed" })).success).toBe(true);
    expect(RouteDecisionSchema.safeParse(withPatch({ language: "kk" })).success).toBe(true);
  });

  it("отклоняет сценарий вне каталога", () => {
    for (const id of ["SC00", "SC41", "BOOKING", "sc01"]) {
      const decision = withPatch({ scenarios: [{ scenario_id: id, confidence: 0.9, reason: "x" }] });
      expect(RouteDecisionSchema.safeParse(decision).success, id).toBe(false);
    }
  });

  it("отклоняет уверенность вне диапазона 0..1", () => {
    for (const confidence of [-0.01, 1.01, Number.NaN]) {
      const decision = withPatch({ scenarios: [{ scenario_id: "SC01", confidence, reason: "x" }] });
      expect(RouteDecisionSchema.safeParse(decision).success, String(confidence)).toBe(false);
    }
  });

  it("требует обоснование у выбранного сценария", () => {
    const decision = withPatch({ scenarios: [{ scenario_id: "SC01", confidence: 0.9 }] });
    expect(RouteDecisionSchema.safeParse(decision).success).toBe(false);
  });

  it("требует хотя бы один выбранный сценарий", () => {
    expect(RouteDecisionSchema.safeParse(withPatch({ scenarios: [] })).success).toBe(false);
  });

  it("отклоняет язык вне ru, kk, mixed", () => {
    expect(RouteDecisionSchema.safeParse(withPatch({ language: "en" })).success).toBe(false);
  });
});

describe("parseRouteDecision — разбор сырого текста ответа модели", () => {
  it("возвращает решение для корректного JSON", () => {
    const result = parseRouteDecision(JSON.stringify(KIT_EXAMPLE));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.scenarios[0]?.scenario_id).toBe("SC30");
  });

  it("не падает на не-JSON и сообщает причину invalid_json", () => {
    const result = parseRouteDecision("Конечно! Вот сценарий: SC30");
    expect(result).toEqual({ ok: false, error: "invalid_json" });
  });

  it("сообщает причину schema_mismatch, если JSON не соответствует контракту", () => {
    const result = parseRouteDecision(JSON.stringify({ scenarios: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("schema_mismatch");
  });
});
