import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RouteDecisionSchema } from "./route-decision";

// Ответ POST /route сервиса выбора сценария (backend/, FastAPI). Та же фикстура сверяется с живым
// ответом эндпоинта в backend/tests/test_api.py — так контракт проверяется с обеих сторон.
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "router-service-route.json");
const response: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));

describe("ответ сервиса выбора сценария (POST /route)", () => {
  it("проходит контракт RouteDecision ядра", () => {
    const parsed = RouteDecisionSchema.safeParse(response);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("дополнительные поля для панели трассировки не мешают разбору", () => {
    expect(response).toMatchObject({
      situation: expect.any(String),
      latency_ms: expect.any(Number),
      scenarios: [{ quote: expect.any(String) }],
    });
  });

  it("альтернативы без пустого обоснования: reason либо отсутствует, либо не пуст", () => {
    const parsed = RouteDecisionSchema.parse(response);
    for (const alt of parsed.alternatives) expect(alt.reason === undefined || alt.reason.length > 0).toBe(true);
  });
});
