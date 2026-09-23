import { describe, expect, it } from "vitest";
import { createServiceGate, routeViaService } from "./router-service";

// Ответ по контракту RouteDecision — та же форма, что в фикстуре packages/core/src/contracts/fixtures/router-service-route.json.
const DECISION = {
  scenarios: [{ scenario_id: "SC17", confidence: 0.92, reason: "клиент спрашивает «когда будет выплата»" }],
  alternatives: [],
  language: "ru",
  slots: {},
  is_continuation: false,
};

const respond = (status: number, body: unknown): typeof fetch => async () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const reject = (error: Error): typeof fetch => async () => {
  throw error;
};

/** Ошибка, которую бросает fetch в Node, когда имя сервиса не разрешается (остановленный контейнер в Compose). */
const dnsFailure = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "EAI_AGAIN" } });

async function failureOf(fetchImpl: typeof fetch): Promise<unknown> {
  try {
    await routeViaService("http://router:8000", "Когда будет выплата?", { lowConfidenceStreak: 0, history: [] }, fetchImpl);
  } catch (e) {
    return e;
  }
  throw new Error("ожидался сбой");
}

describe("routeViaService — вызов сервиса выбора сценария", () => {
  it("возвращает решение по контракту", async () => {
    const decision = await routeViaService("http://router:8000/", "x", { lowConfidenceStreak: 0, history: [] }, respond(200, DECISION));
    expect(decision.scenarios[0]?.scenario_id).toBe("SC17");
  });

  it("ответ с HTTP-ошибкой — сервис жив, сообщение с кодом", async () => {
    const error = await failureOf(respond(504, { detail: "таймаут модели" }));
    expect(String(error)).toContain("router-service 504");
  });
});

describe("createServiceGate — пауза после сбоя сервиса", () => {
  const setup = () => {
    let now = 1_000;
    const gate = createServiceGate(30_000, () => now);
    return { gate, advance: (ms: number) => (now += ms) };
  };

  it.each([502, 503, 504])("HTTP %i не включает паузу: следующий ход снова идёт в сервис", async (status) => {
    const { gate } = setup();
    gate.recordFailure(await failureOf(respond(status, { detail: "x" })));
    expect(gate.isPaused()).toBe(false);
  });

  it("ответ вне контракта не включает паузу: сервис ответил", async () => {
    const { gate } = setup();
    gate.recordFailure(await failureOf(respond(200, { scenarios: [] })));
    expect(gate.isPaused()).toBe(false);
  });

  it("сервис не отвечает (DNS, EAI_AGAIN) — пауза включается", async () => {
    const { gate } = setup();
    gate.recordFailure(await failureOf(reject(dnsFailure())));
    expect(gate.isPaused()).toBe(true);
  });

  it("таймаут самого HTTP-запроса — пауза включается", async () => {
    const { gate } = setup();
    gate.recordFailure(await failureOf(reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))));
    expect(gate.isPaused()).toBe(true);
  });

  it("после паузы сервис снова опрашивается", async () => {
    const { gate, advance } = setup();
    gate.recordFailure(await failureOf(reject(dnsFailure())));
    advance(29_999);
    expect(gate.isPaused()).toBe(true);
    advance(1);
    expect(gate.isPaused()).toBe(false);
  });
});
