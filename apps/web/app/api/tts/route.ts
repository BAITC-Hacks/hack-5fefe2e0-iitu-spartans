import { hasModelKey } from "../../../lib/server/completion";

/**
 * Голос робота на сервере (OpenAI TTS). Голоса браузера на Windows часто нет для казахского, и ответ читается
 * русским голосом; модель синтеза читает текст на его языке. Ответ отдаётся потоком: браузер начинает
 * воспроизведение с первых байт, не дожидаясь всей записи.
 */
export const dynamic = "force-dynamic";

const ENDPOINT = "https://api.openai.com/v1/audio/speech";
const MAX_TEXT = 600;

const INSTRUCTIONS: Record<string, string> = {
  kk: "Сен сақтандыру компаниясы байланыс орталығының сыпайы операторысың. Қазақ тілінде анық, жылы және қысқа сөйле.",
  ru: "Ты вежливый оператор контакт-центра страховой компании. Говори по-русски чётко, тепло и без спешки.",
};

/** Озвучка текста потоком; ошибки — JSON с кодом, как у остальных маршрутов API. */
async function synthesize(rawText: unknown, rawLang: unknown): Promise<Response> {
  if (!hasModelKey()) return Response.json({ error: "no_model_key" }, { status: 503 });
  const text = (typeof rawText === "string" ? rawText : "").trim().slice(0, MAX_TEXT);
  if (!text) return Response.json({ error: "no_text" }, { status: 400 });
  const language = rawLang === "kk" ? "kk" : "ru";

  const upstream = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
    body: JSON.stringify({
      // Compose передаёт незаданную переменную пустой строкой, поэтому ||, а не ??.
      model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.TTS_VOICE || "coral",
      input: text,
      instructions: INSTRUCTIONS[language],
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return Response.json({ error: `tts_${upstream?.status ?? "network"}` }, { status: 502 });

  return new Response(upstream.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}

/** Для <audio src>: элемент умеет только GET и сразу играет поток. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return synthesize(params.get("text"), params.get("lang"));
}

/** Для программных клиентов: тело JSON { text, lang }. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: unknown; lang?: unknown } | null;
  return synthesize(body?.text, body?.lang);
}
