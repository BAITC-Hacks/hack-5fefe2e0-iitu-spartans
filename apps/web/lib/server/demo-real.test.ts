import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CatalogSchema, demoDecision } from "@voice-router/core";

// Режим без ключа на полном каталоге стартового набора: реплики, на которых простое совпадение слов
// путало сценарии из-за общих слов («страховка», «полис»). Редкие слова должны весить больше частых.
const catalog = CatalogSchema.parse(
  JSON.parse(readFileSync(path.resolve(__dirname, "../../../../data/kit/scenarios.json"), "utf8")),
);

describe("demoDecision на каталоге набора", () => {
  it("статус страхового случая -> SC17", () => {
    expect(demoDecision(catalog, "хочу узнать статус страхового случая").scenarios[0]?.scenario_id).toBe("SC17");
  });

  it("оплата списана, а полис не оформлен -> SC30", () => {
    expect(demoDecision(catalog, "я оплатил, деньги списались, а полис не оформлен").scenarios[0]?.scenario_id).toBe("SC30");
  });

  it("казахская реплика о статусе заявления -> SC17", () => {
    expect(demoDecision(catalog, "Өтінішім қандай күйде?").scenarios[0]?.scenario_id).toBe("SC17");
  });
});
