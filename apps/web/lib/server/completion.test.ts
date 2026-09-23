import { describe, expect, it } from "vitest";
import { routerProvider } from "./completion";

// Поставщик модели выбора сценария задаётся окружением: один промпт и одна проверка ответа для любого
// OpenAI-совместимого входа (Chat Completions). Так модели сравниваются на одном dev-наборе без правки кода.
describe("routerProvider — поставщик модели маршрутизатора ядра", () => {
  it("по умолчанию — OpenAI с ключом OPENAI_API_KEY и моделью gpt-5.4-mini без рассуждения", () => {
    expect(routerProvider({ OPENAI_API_KEY: "k-openai" })).toEqual({
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "k-openai",
      model: "gpt-5.4-mini",
      reasoningEffort: "none",
    });
  });

  it("OpenAI-совместимый вход другого поставщика: адрес, свой ключ и модель", () => {
    expect(
      routerProvider({
        OPENAI_API_KEY: "k-openai",
        ROUTER_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        ROUTER_API_KEY: "k-gemini",
        ROUTER_MODEL: "gemini-3.8-flash",
      }),
    ).toEqual({
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: "k-gemini",
      model: "gemini-3.8-flash",
    });
  });

  it("глубина рассуждения передаётся любой модели, если задана явно", () => {
    expect(routerProvider({ ROUTER_API_KEY: "k", ROUTER_MODEL: "gemini-3.8-flash", ROUTER_REASONING_EFFORT: "low" })?.reasoningEffort).toBe(
      "low",
    );
  });

  it("пустые строки из Compose считаются незаданными; без ключа поставщика нет", () => {
    expect(routerProvider({ OPENAI_API_KEY: "", ROUTER_API_KEY: "", ROUTER_BASE_URL: "", ROUTER_MODEL: "" })).toBeNull();
    expect(routerProvider({ OPENAI_API_KEY: "k", ROUTER_MODEL: "" })?.model).toBe("gpt-5.4-mini");
  });
});
