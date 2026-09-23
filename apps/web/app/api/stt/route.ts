import { hasModelKey } from "../../../lib/server/completion";
import { transcribe, transcriptionHints } from "../../../lib/server/transcribe";

/**
 * Распознавание речи на сервере. GET сообщает интерфейсу, доступно ли оно (есть ли ключ модели): без ключа
 * интерфейс остаётся на распознавании браузера (Положение §5.6.6). POST принимает запись реплики в поле audio.
 */
export const dynamic = "force-dynamic";

/** Реплика клиента — секунды речи; больше 10 МБ — не реплика, а ошибка записи. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Array<[string, string]> = [
  ["webm", "webm"],
  ["ogg", "ogg"],
  ["mp4", "mp4"],
  ["mpeg", "mp3"],
  ["mp3", "mp3"],
  ["wav", "wav"],
];

export function GET() {
  return Response.json({ available: hasModelKey(), model: process.env.STT_MODEL || "gpt-transcribe" });
}

export async function POST(request: Request) {
  if (!hasModelKey()) return Response.json({ error: "no_model_key" }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "no_audio" }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "audio_too_large" }, { status: 413 });

  // OpenAI определяет формат записи по расширению имени файла: webm с именем .mp3 он отвергает как повреждённый.
  const extension = EXTENSIONS.find(([mime]) => audio.type.includes(mime))?.[1] ?? "webm";
  const result = await transcribe(audio, `speech.${extension}`, transcriptionHints(), {
    fetch,
    apiKey: process.env.OPENAI_API_KEY ?? "",
    now: Date.now,
  });
  return result.ok ? Response.json({ text: result.text, ms: result.ms }) : Response.json({ error: result.error }, { status: 502 });
}
