import { z } from "zod";
import { ScenarioIdSchema } from "../contracts/route-decision";

/**
 * Каталог сценариев — подмножество полей scenarios.json стартового набора, нужное маршрутизатору.
 * Данные проверяются схемой при загрузке: ошибка в каталоге должна остановить запуск, а не испортить промпт.
 * Лишние поля набора (слоты, действия, фразы ответа) отбрасываются — они нужны исполнителю сценария, а не выбору.
 */

export const NotThisIfSchema = z.object({
  condition: z.string().min(1),
  use_instead: ScenarioIdSchema,
});

export const CatalogScenarioSchema = z.object({
  scenario_id: z.string().regex(/^SC(0[1-9]|[1-3][0-9]|40)$/),
  name: z.string().min(1),
  description: z.string().min(1),
  not_this_if: z.array(NotThisIfSchema),
  priority: z.enum(["normal", "high", "urgent"]),
  examples: z.object({ ru: z.array(z.string()), kk: z.array(z.string()) }),
  /** Фразы ответа из набора: начальная и заключительная, на русском и казахском. */
  responses: z
    .object({
      ru: z.object({ opening: z.string(), closing: z.string() }),
      kk: z.object({ opening: z.string(), closing: z.string() }),
    })
    .optional(),
});

export const SystemIntentSchema = z.object({
  id: z.enum(["SYS_OUT_OF_SCOPE", "SYS_UNCLEAR", "SYS_GOODBYE"]),
  description: z.string().min(1),
  /** Фраза ответа; у SYS_UNCLEAR — шаблон с {option_a} и {option_b}. */
  response: z.object({ ru: z.string(), kk: z.string() }).optional(),
});

export const CatalogSchema = z.object({
  scenarios: z.array(CatalogScenarioSchema).min(1),
  system_intents: z.array(SystemIntentSchema),
});

export type Catalog = z.infer<typeof CatalogSchema>;
export type CatalogScenario = z.infer<typeof CatalogScenarioSchema>;

/** Все идентификаторы, которые маршрутизатору разрешено вернуть: сценарии каталога и системные намерения. */
export function knownIds(catalog: Catalog): Set<string> {
  return new Set([...catalog.scenarios.map((s) => s.scenario_id), ...catalog.system_intents.map((i) => i.id)]);
}
