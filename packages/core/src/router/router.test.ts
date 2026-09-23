import { describe, expect, it } from "vitest";
import { CatalogSchema } from "./catalog";
import { CATALOG_FIXTURE, VALID_ANSWER } from "./fixtures";
import { buildRouterMessages } from "./prompt";
import { routeUtterance, type RouterDeps } from "./router";

/** Поддельная модель: отдаёт заранее заданные ответы по очереди и записывает, что ей отправили. */
function fakeModel(answers: Array<string | Error>) {
  const calls: Array<{ system: string; user: string }> = [];
  let clock = 1000;
  const deps: RouterDeps = {
    complete: async (messages) => {
      calls.push(messages);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next ?? "";
    },
    now: () => (clock += 40),
  };
  return { deps, calls };
}

const context = { history: [] };

describe("CatalogSchema — каталог сценариев из данных набора", () => {
  it("принимает фрагмент со структурой scenarios.json", () => {
    expect(CatalogSchema.safeParse(CATALOG_FIXTURE).success).toBe(true);
  });

  it("отклоняет правило not_this_if без сценария-замены", () => {
    const broken = structuredClone(CATALOG_FIXTURE) as { scenarios: Array<{ not_this_if: unknown[] }> };
    broken.scenarios[0]!.not_this_if = [{ condition: "x" }];
    expect(CatalogSchema.safeParse(broken).success).toBe(false);
  });
});

describe("buildRouterMessages — промпт LLM-маршрутизатора", () => {
  const { system, user } = buildRouterMessages(CATALOG_FIXTURE, context, "Когда будет выплата?");

  it("содержит каждый сценарий каталога с описанием", () => {
    for (const s of CATALOG_FIXTURE.scenarios) {
      expect(system).toContain(s.scenario_id);
      expect(system).toContain(s.description);
    }
  });

  it("содержит правила разграничения not_this_if с указанием сценария-замены", () => {
    expect(system).toContain("Client disagrees with the decision or the amount");
    expect(system).toMatch(/Client disagrees with the decision or the amount[^\n]*SC19/);
  });

  it("содержит примеры на русском и казахском", () => {
    expect(system).toContain("Какой статус по моему заявлению?");
    expect(system).toContain("Өтінішім қандай күйде?");
  });

  it("описывает системные намерения и требует ответ только в JSON", () => {
    expect(system).toContain("SYS_UNCLEAR");
    expect(system).toContain("SYS_OUT_OF_SCOPE");
    expect(system).toMatch(/JSON/);
  });

  it("передаёт реплику клиента и состояние диалога", () => {
    const withState = buildRouterMessages(
      CATALOG_FIXTURE,
      { language: "kk", activeScenario: "SC17", history: [{ role: "client", text: "Сәлеметсіз бе" }] },
      "Төлем қашан болады?",
    );
    expect(withState.user).toContain("Төлем қашан болады?");
    expect(withState.user).toContain("SC17");
    expect(withState.user).toContain("Сәлеметсіз бе");
  });

  it("требует обоснование на русском со ссылкой на слова клиента и правило каталога", () => {
    // Панель супервизора русскоязычная: обоснование на английском модель писала примерно в половине ходов.
    expect(system).toMatch(/reason:[^\n]*in Russian/);
    expect(system).toMatch(/reason:[^\n]*Not this if/);
  });

  it("детерминирован: одинаковый вход даёт одинаковый промпт", () => {
    expect(buildRouterMessages(CATALOG_FIXTURE, context, "x")).toEqual(buildRouterMessages(CATALOG_FIXTURE, context, "x"));
  });
});

describe("routeUtterance — выбор сценария через модель", () => {
  it("возвращает решение и время работы маршрутизатора", async () => {
    const { deps } = fakeModel([VALID_ANSWER]);
    const outcome = await routeUtterance({ utterance: "Когда будет выплата?", context, catalog: CATALOG_FIXTURE }, deps);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.decision.scenarios[0]?.scenario_id).toBe("SC17");
      expect(outcome.attempts).toBe(1);
      expect(outcome.latencyMs).toBe(40);
    }
  });

  it("повторяет запрос один раз, если модель ответила не JSON", async () => {
    const { deps, calls } = fakeModel(["Конечно! Это SC17.", VALID_ANSWER]);
    const outcome = await routeUtterance({ utterance: "Когда будет выплата?", context, catalog: CATALOG_FIXTURE }, deps);
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(2);
    if (outcome.ok) expect(outcome.attempts).toBe(2);
  });

  it("после двух неудачных ответов возвращает отказ с причиной, а не исключение", async () => {
    const { deps } = fakeModel(["не json", "{}"]);
    const outcome = await routeUtterance({ utterance: "x", context, catalog: CATALOG_FIXTURE }, deps);
    expect(outcome).toMatchObject({ ok: false, error: "schema_mismatch", attempts: 2 });
  });

  it("отклоняет сценарий, которого нет в каталоге (защита от выдуманного ответа)", async () => {
    const invented = VALID_ANSWER.replace('"SC17"', '"SC05"');
    const { deps } = fakeModel([invented, invented]);
    const outcome = await routeUtterance({ utterance: "x", context, catalog: CATALOG_FIXTURE }, deps);
    expect(outcome).toMatchObject({ ok: false, error: "unknown_scenario" });
  });

  it("сбой вызова модели превращает в отказ completion_failed", async () => {
    const { deps } = fakeModel([new Error("network"), new Error("network")]);
    const outcome = await routeUtterance({ utterance: "x", context, catalog: CATALOG_FIXTURE }, deps);
    expect(outcome).toMatchObject({ ok: false, error: "completion_failed", attempts: 2 });
  });
});
