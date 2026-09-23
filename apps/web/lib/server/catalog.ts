import { readFileSync } from "node:fs";
import path from "node:path";
import { CatalogSchema, type Catalog, type Priority, type ScenarioLabels } from "@voice-router/core";

/**
 * Каталог сценариев и подписи для ответов. Загружается один раз на процесс из стартового набора (data/kit).
 * Каталог проверяется схемой: ошибка в данных должна остановить сервер при первом запросе, а не исказить промпт.
 */

// Путь к данным читается во время работы сервера, а не при сборке: пометка turbopackIgnore исключает его из трассировки сборки.
const DATA_DIR = process.env.DATA_DIR || path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../../data/kit");

/** Русские и казахские названия сценариев — из таблицы «Сценарии» README набора (в scenarios.json они на английском). */
function labelsFromReadme(file: string): Record<string, string> {
  const labels: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(path.join(/*turbopackIgnore: true*/ DATA_DIR, file), "utf8");
  } catch {
    return labels;
  }
  for (const match of text.matchAll(/^\|\s*(SC\d{2})\s*\|\s*([^|]+?)\s*\|/gm)) {
    const [, id, name] = match;
    if (id && name) labels[id] = `«${name.charAt(0).toLowerCase()}${name.slice(1)}»`;
  }
  return labels;
}

/** Название сценария для панели — без кавычек и с заглавной буквы; кавычки нужны только внутри фразы робота. */
export function scenarioDisplayName(labels: ScenarioLabels, id: string): string {
  const name = labels.ru[id]?.replace(/^«|»$/g, "");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : id;
}

let cached: { catalog: Catalog; labels: ScenarioLabels; priorityOf: (id: string) => Priority } | null = null;

export function loadCatalog() {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ DATA_DIR, "scenarios.json"), "utf8"));
  const catalog = CatalogSchema.parse(raw);
  const priorities = new Map(catalog.scenarios.map((s) => [s.scenario_id, s.priority] as const));
  cached = {
    catalog,
    labels: { ru: labelsFromReadme("README.ru.md"), kk: labelsFromReadme("README.kz.md") },
    priorityOf: (id) => priorities.get(id) ?? "normal",
  };
  return cached;
}
