import { GoogleGenAI } from "@google/genai";
import { LIVE_MODEL, liveConfig } from "../../../../lib/live/config";

/**
 * Эфемерный токен для страницы /live: браузер подключается к Gemini Live напрямую, ключ API остаётся на сервере.
 * Токен одноразовый, окно подключения — минута, звонок — не дольше десяти минут; конфигурация звонка зашита
 * в ограничения токена, поэтому браузер не может её подменить.
 */
export const dynamic = "force-dynamic";

const SESSION_MAX_MS = 10 * 60_000;
const CONNECT_WINDOW_MS = 60_000;

export async function GET(): Promise<Response> {
  return Response.json({ available: Boolean(process.env.GEMINI_API_KEY), model: LIVE_MODEL });
}

export async function POST(): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "no_gemini_key" }, { status: 503 });
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  const now = Date.now();
  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + SESSION_MAX_MS).toISOString(),
        newSessionExpireTime: new Date(now + CONNECT_WINDOW_MS).toISOString(),
        liveConnectConstraints: { model: LIVE_MODEL, config: liveConfig() },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    if (!token.name) return Response.json({ error: "token_without_name" }, { status: 502 });
    return Response.json({ token: token.name, model: LIVE_MODEL });
  } catch (error) {
    // Текст ошибки Google нужен на экране: типичная причина — ключ с ограничением по IP или без доступа к Live.
    return Response.json({ error: (error instanceof Error ? error.message : String(error)).slice(0, 400) }, { status: 502 });
  }
}
