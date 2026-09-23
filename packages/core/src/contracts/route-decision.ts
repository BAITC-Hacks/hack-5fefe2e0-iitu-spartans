import { z } from "zod";

/**
 * Контракт ответа LLM-маршрутизатора.
 *
 * Формат повторяет раздел «Уровень 2 — LLM-маршрутизатор» README стартового набора организаторов.
 * Ответ модели — недоверенный ввод: до валидации по этой схеме он не попадает ни в политику решений,
 * ни в трассировку.
 */

/** 40 сценариев каталога (SC01–SC40) и 3 системных намерения. */
export const ScenarioIdSchema = z
  .string()
  .regex(/^(SC(0[1-9]|[1-3][0-9]|40)|SYS_(OUT_OF_SCOPE|UNCLEAR|GOODBYE))$/, "сценарий вне каталога");

const ConfidenceSchema = z.number().min(0).max(1);

export const ScenarioScoreSchema = z.object({
  scenario_id: ScenarioIdSchema,
  confidence: ConfidenceSchema,
  reason: z.string().min(1),
});

export const AlternativeSchema = z.object({
  scenario_id: ScenarioIdSchema,
  confidence: ConfidenceSchema,
  reason: z.string().min(1).optional(),
});

export const LanguageSchema = z.enum(["ru", "kk", "mixed"]);

/** Значения слотов по типам slots.json: строка, число, логическое значение, список строк. */
const SlotValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

export const RouteDecisionSchema = z.object({
  scenarios: z.array(ScenarioScoreSchema).min(1),
  alternatives: z.array(AlternativeSchema),
  language: LanguageSchema,
  slots: z.record(z.string(), SlotValueSchema),
  is_continuation: z.boolean(),
});

export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

export type ParseResult =
  | { ok: true; decision: RouteDecision }
  | { ok: false; error: "invalid_json" | "schema_mismatch"; issues?: string[] };

/**
 * Разбор сырого текста ответа модели. Никогда не бросает исключение: вызывающий код получает
 * причину отказа и решает сам — повторить запрос, переспросить клиента или передать оператору.
 */
export function parseRouteDecision(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  const parsed = RouteDecisionSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: "schema_mismatch",
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  return { ok: true, decision: parsed.data };
}
