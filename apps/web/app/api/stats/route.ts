import { loadCatalog } from "../../../lib/server/catalog";
import { pool } from "../../../lib/server/db";
import { supervisorStats } from "../../../lib/server/stats";

// Сводка журнала для панели супервизора: GET /api/stats. Вызывается по событию (после хода, по кнопке), не опросом.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (!pool) return Response.json({ error: "DATABASE_URL не задан" }, { status: 503 });
  try {
    const stats = await supervisorStats(pool);
    // Названия сценариев — те же, что в трассировке хода: русские из README набора, без кавычек, с заглавной буквы.
    const { catalog, labels } = loadCatalog();
    const names = Object.fromEntries(
      catalog.scenarios.map((s) => {
        const name = labels.ru[s.scenario_id]?.replace(/^«|»$/g, "");
        return [s.scenario_id, name ? name.charAt(0).toUpperCase() + name.slice(1) : s.name];
      }),
    );
    return Response.json({ ...stats, names });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
