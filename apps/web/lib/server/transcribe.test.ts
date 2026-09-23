import { describe, expect, it } from "vitest";
import type { TranscriptionHints } from "@voice-router/core/stt";
import { transcribe, type TranscribeDeps } from "./transcribe";

// Распознавание проверяется без сети: fetch подменяется и записывает, что ушло в OpenAI.
const HINTS: TranscriptionHints = {
  model: "gpt-transcribe",
  prompt: "Хочу продлить КАСКО. Полисімді ұзартқым келеді.",
  keywords: ["КАСКО", "ОГПО"],
  languages: ["ru", "kk"],
};

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let clock = 0;
  const deps: TranscribeDeps = {
    apiKey: "test-key",
    now: () => (clock += 300),
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond();
    }) as unknown as typeof fetch,
  };
  return { deps, calls };
}

const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });

describe("transcribe — серверное распознавание речи", () => {
  it("отправляет запись, модель, подсказку словаря и оба языка", async () => {
    const { deps, calls } = fakeFetch(() => Response.json({ text: "Полисімді ұзартқым келеді" }));
    await transcribe(audio, "speech.webm", HINTS, deps);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer test-key");
    const form = calls[0]?.init.body as FormData;
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("model")).toBe("gpt-transcribe");
    expect(form.get("prompt")).toBe(HINTS.prompt);
    expect(form.getAll("languages[]")).toEqual(["ru", "kk"]);
    expect(form.getAll("keywords[]")).toEqual(["КАСКО", "ОГПО"]);
  });

  it("возвращает текст без пробелов по краям и время распознавания", async () => {
    const { deps } = fakeFetch(() => Response.json({ text: "  Өтінішім қандай күйде?  " }));
    expect(await transcribe(audio, "speech.webm", HINTS, deps)).toEqual({ ok: true, text: "Өтінішім қандай күйде?", ms: 300 });
  });

  it("ошибку API возвращает кодом, а не исключением", async () => {
    const { deps } = fakeFetch(() => new Response("rate limit", { status: 429 }));
    expect(await transcribe(audio, "speech.webm", HINTS, deps)).toEqual({ ok: false, error: "http_429" });
  });

  it("пустой текст считает неудачей: робот не должен отвечать на тишину", async () => {
    const { deps } = fakeFetch(() => Response.json({ text: "   " }));
    expect(await transcribe(audio, "speech.webm", HINTS, deps)).toEqual({ ok: false, error: "empty" });
  });

  it("сбой сети превращает в код network", async () => {
    const { deps } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await transcribe(audio, "speech.webm", HINTS, deps)).toEqual({ ok: false, error: "network" });
  });
});
