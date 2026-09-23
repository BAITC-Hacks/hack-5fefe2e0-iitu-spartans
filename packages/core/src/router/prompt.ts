import type { Catalog, CatalogScenario } from "./catalog";

/**
 * Промпт LLM-маршрутизатора. Модель выбирает сценарий по описанию и правилам разграничения not_this_if,
 * а не по совпадению с обучающими формулировками — в этом отличие от классификатора намерений (ТЗ, раздел 8).
 *
 * Промпт детерминирован: одинаковый вход даёт одинаковый текст. Это нужно для воспроизводимых замеров
 * и для кэширования префикса промпта на стороне модели (каталог — неизменная часть в начале).
 */

export interface DialogContext {
  language?: "ru" | "kk" | "mixed";
  activeScenario?: string;
  history: Array<{ role: "client" | "bot"; text: string }>;
}

export interface RouterMessages {
  system: string;
  user: string;
}

/** Сколько примеров брать на сценарий и сколько последних реплик передавать: баланс точности и задержки. */
const EXAMPLES_RU = 3;
const EXAMPLES_KK = 2;
const HISTORY_TURNS = 6;

function scenarioLine(s: CatalogScenario): string {
  const rules = s.not_this_if.map((r) => `${r.condition} -> use ${r.use_instead}`).join("; ");
  const examples = [
    ...s.examples.ru.slice(0, EXAMPLES_RU).map((e) => `ru «${e}»`),
    ...s.examples.kk.slice(0, EXAMPLES_KK).map((e) => `kk «${e}»`),
  ].join("; ");
  return `- ${s.scenario_id} "${s.name}" [priority: ${s.priority}]: ${s.description}` +
    (rules ? ` Not this if: ${rules}.` : "") +
    (examples ? ` Examples: ${examples}.` : "");
}

export function buildRouterMessages(catalog: Catalog, context: DialogContext, utterance: string): RouterMessages {
  const system = [
    "You are the scenario router of an insurance contact-center voice robot.",
    "Choose the scenario(s) for the client's utterance using the catalog below. Decide by meaning and dialog context,",
    "not by word overlap with the examples. Apply every 'Not this if' rule: when its condition holds, use the scenario it names.",
    "The client may speak Russian, Kazakh, or mix both inside one phrase.",
    "",
    "Rules:",
    "- One utterance may contain several requests: list every scenario in the order the client mentioned them.",
    "- confidence is your probability (0..1) that the scenario is correct; do not inflate it.",
    "- reason: one short sentence naming the words or facts in the utterance that decided the choice.",
    "- alternatives: up to 3 other plausible scenarios with their confidence.",
    "- language: ru, kk, or mixed (both languages inside the utterance).",
    "- slots: values stated in the utterance (phone, dates, plate numbers), normalized; empty object if none.",
    "- is_continuation: true only if the utterance answers or continues the active scenario rather than starting a new request.",
    "- Use a system intent when no catalog scenario fits.",
    "",
    "Catalog:",
    ...catalog.scenarios.map(scenarioLine),
    "",
    "System intents:",
    ...catalog.system_intents.map((i) => `- ${i.id}: ${i.description}`),
    "",
    "Answer with JSON only, no prose, exactly in this shape:",
    '{"scenarios":[{"scenario_id":"SC01","confidence":0.9,"reason":"..."}],"alternatives":[{"scenario_id":"SC02","confidence":0.3}],"language":"ru","slots":{},"is_continuation":false}',
  ].join("\n");

  const history = context.history.slice(-HISTORY_TURNS).map((t) => `${t.role}: ${t.text}`);
  const user = [
    "Dialog state:",
    `- language so far: ${context.language ?? "unknown"}`,
    `- active scenario: ${context.activeScenario ?? "none"}`,
    "Recent turns:",
    ...(history.length > 0 ? history : ["(none)"]),
    "",
    "Client utterance:",
    utterance,
  ].join("\n");

  return { system, user };
}
