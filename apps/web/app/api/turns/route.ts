import { pool } from "../../../lib/server/db";
import { recentTurns } from "../../../lib/server/journal";

// Лента последних ходов для панели супервизора: GET /api/turns?limit=20 (не больше 100).
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!pool) return Response.json({ turns: [], error: "DATABASE_URL не задан" }, { status: 503 });
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 100) : 20;
  try {
    return Response.json({ turns: await recentTurns(pool, limit) });
  } catch (error) {
    return Response.json({ turns: [], error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
