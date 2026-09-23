import { describe, expect, it } from "vitest";
import { parseSttResponse, ttsUrl } from "./server-voice";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("parseSttResponse — ответ POST /api/stt для кнопки микрофона", () => {
  it("текст, язык и задержка распознавания", async () => {
    expect(await parseSttResponse(json(200, { text: "ОГПО бағасы қанша?", language: "kk", latency_ms: 910 }))).toEqual({
      ok: true,
      text: "ОГПО бағасы қанша?",
      language: "kk",
      latencyMs: 910,
    });
  });

  it("тишина (empty) — не повод уходить с серверного пути: клиент просто повторит", async () => {
    expect(await parseSttResponse(json(502, { error: "empty" }))).toEqual({ ok: false, error: "empty", fallback: false });
  });

  it.each([
    [503, "no_model_key"],
    [502, "http_500"],
    [502, "timeout"],
    [502, "network"],
  ])("HTTP %i %s — серверное распознавание недоступно, переходим на браузерное", async (status, error) => {
    expect(await parseSttResponse(json(status, { error }))).toEqual({ ok: false, error, fallback: true });
  });

  it("сеть до нашего сервера не ответила — тоже запасной путь", async () => {
    expect(await parseSttResponse(null)).toEqual({ ok: false, error: "network", fallback: true });
  });

  it("ответ не JSON — запасной путь", async () => {
    expect(await parseSttResponse(new Response("<html>", { status: 500 }))).toEqual({
      ok: false,
      error: "http_500",
      fallback: true,
    });
  });
});

describe("ttsUrl — адрес потоковой озвучки для <audio>", () => {
  it("казахский ответ озвучивается казахским, смешанный и русский — русским", () => {
    expect(ttsUrl("Сәлеметсіз бе", "kk")).toBe("/api/tts?lang=kk&text=%D0%A1%D3%99%D0%BB%D0%B5%D0%BC%D0%B5%D1%82%D1%81%D1%96%D0%B7+%D0%B1%D0%B5");
    expect(ttsUrl("Здравствуйте", "mixed")).toContain("lang=ru");
    expect(ttsUrl("Здравствуйте", "ru")).toContain("lang=ru");
  });
});
