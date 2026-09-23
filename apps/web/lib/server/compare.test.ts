import { describe, expect, it } from "vitest";
// Фикстуры ядра не входят в публичный экспорт пакета: берём их по пути внутри рабочего пространства.
import { CATALOG_FIXTURE, VALID_ANSWER } from "../../../../packages/core/src/router/fixtures";
import { compareEngines, type EngineSpec } from "./compare";
import type { RouterProvider } from "./completion";

/**
 * Сравнение движков без сети: функция `complete` подменяется по поставщику. Проверяется контракт окна сравнения:
 * недоступный движок не получает выдуманного решения, расхождение основного сценария видно флагом,
 * ошибка одного движка не ломает результат другого.
 */

const OPENAI: RouterProvider = { endpoint: "https://api.openai.com/v1/chat/completions", apiKey: "k1", model: "gpt-5.4-mini" };
const GEMINI: RouterProvider = {
  endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  apiKey: "k2",
  model: "gemini-3.8-flash",
};

const valid = JSON.parse(VALID_ANSWER) as { scenarios: Array<{ scenario_id: string }> };
const PRIMARY = valid.scenarios[0]?.scenario_id ?? "";
const OTHER = CATALOG_FIXTURE.scenarios.find((s) => s.scenario_id !== PRIMARY)?.scenario_id ?? "";

function answerWith(scenarioId: string): string {
  return JSON.stringify({ ...JSON.parse(VALID_ANSWER), scenarios: [{ scenario_id: scenarioId, confidence: 0.9, reason: "тест" }] });
}

const request = { utterance: "хочу узнать статус", context: { history: [] }, catalog: CATALOG_FIXTURE };
const nameOf = (id: string) => `Название ${id}`;
const both: EngineSpec[] = [
  { id: "openai", provider: OPENAI },
  { id: "gemini", provider: GEMINI },
];

describe("compareEngines — окно сравнения движков выбора сценария", () => {
  it("оба движка ответили одним сценарием: agree=true, у каждого модель и задержка", async () => {
    const result = await compareEngines(request, both, { complete: () => async () => VALID_ANSWER, nameOf, now: () => 0 });
    expect(result.agree).toBe(true);
    expect(result.engines.map((e) => [e.id, e.model, e.available])).toEqual([
      ["openai", "gpt-5.4-mini", true],
      ["gemini", "gemini-3.8-flash", true],
    ]);
    expect(result.scenarioNames[PRIMARY]).toBe(`Название ${PRIMARY}`);
  });

  it("основной сценарий разошёлся: agree=false, решения обоих сохранены", async () => {
    const complete = (provider: RouterProvider) => async () => (provider === GEMINI ? answerWith(OTHER) : answerWith(PRIMARY));
    const result = await compareEngines(request, both, { complete, nameOf });
    expect(result.agree).toBe(false);
    expect(result.engines[0]?.decision?.scenarios[0]?.scenario_id).toBe(PRIMARY);
    expect(result.engines[1]?.decision?.scenarios[0]?.scenario_id).toBe(OTHER);
  });

  it("движок без ключа недоступен и без решения; сравнивать не с чем — agree=null", async () => {
    const result = await compareEngines(request, [both[0]!, { id: "gemini", provider: null }], {
      complete: () => async () => VALID_ANSWER,
      nameOf,
    });
    expect(result.engines[1]).toMatchObject({ id: "gemini", available: false, decision: null, model: null });
    expect(result.agree).toBeNull();
  });

  it("сбой одного движка попадает в его error и не ломает другой", async () => {
    const complete = (provider: RouterProvider) => async () => {
      if (provider === GEMINI) throw new Error("model 403: ip restricted");
      return VALID_ANSWER;
    };
    const result = await compareEngines(request, both, { complete, nameOf });
    expect(result.engines[0]?.decision).not.toBeNull();
    expect(result.engines[1]?.decision).toBeNull();
    expect(result.engines[1]?.error).toContain("completion_failed");
    expect(result.engines[1]?.error).toContain("403");
    expect(result.agree).toBeNull();
  });
});
