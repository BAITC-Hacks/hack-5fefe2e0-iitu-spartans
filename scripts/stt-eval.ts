/**
 * Оценка словаря терминов на распознавании речи (issue #8).
 *
 *   pnpm stt:eval --kit <каталог набора>            # нужен OPENAI_API_KEY в окружении или в .env
 *   pnpm stt:eval --kit <каталог набора> --dry-run  # без обращений к API: выборка и подсказка
 *
 * Берёт из dev_utterances.json реплики с продуктовыми терминами словаря (аббревиатуры и термины,
 * связанные со значениями слота product_type), синтезирует речь (TTS) и распознаёт её дважды: без подсказки и
 * с подсказкой из словаря. Считает долю реплик, где все термины распознаны без искажения, полноту
 * терминов и WER — отдельно для ru, kk, mixed.
 *
 * Ограничение: синтезированная речь чище живой (нет шума, акцента, оговорок). Оценка показывает
 * вклад подсказки при прочих равных, а не качество распознавания живого звонка.
 *
 * Аудио и результаты — в test-results/stt-eval/ (каталог исключён из git в .gitignore).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { GlossarySchema, type Term } from "../packages/core/src/stt/glossary.ts";
import { findTerms, wordErrorRate } from "../packages/core/src/stt/metrics.ts";
import {
  buildTranscriptionHints,
  STT_MODELS,
  toTranscriptionFormFields,
  type SttModel,
  type TranscriptionHints,
} from "../packages/core/src/stt/transcription-hints.ts";

const ROOT = path.join(import.meta.dirname, "..");
const API = "https://api.openai.com/v1";

const { values } = parseArgs({
  options: {
    kit: { type: "string" },
    model: { type: "string", default: "gpt-transcribe" },
    "tts-model": { type: "string", default: "gpt-4o-mini-tts" },
    voice: { type: "string", default: "alloy" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const model = values.model as SttModel;
if (!STT_MODELS.includes(model)) throw new Error(`--model: одна из ${STT_MODELS.join(", ")}`);
const kitDir = path.resolve(values.kit ?? process.env.KIT_DIR ?? path.join(ROOT, "data/kit"));
const outDir = path.resolve(values.out ?? path.join(ROOT, "test-results/stt-eval"));

// ---------- данные ----------

const glossary = GlossarySchema.parse(
  JSON.parse(await readFile(path.join(ROOT, "packages/core/src/stt/stt-glossary.json"), "utf8")),
);
const devFile = path.join(kitDir, "dev_utterances.json");
const dev = JSON.parse(await readFile(devFile, "utf8").catch(() => {
  throw new Error(`${devFile} не найден. Стартовый набор: data/kit (#3), другой каталог: --kit <путь> или KIT_DIR.`);
})) as { utterances: Array<{ id: string; text: string; lang: "ru" | "kk" | "mixed" }> };

/**
 * Продуктовые термины — то, что проверяет критерий приёмки: аббревиатуры словаря и термины, связанные
 * со значениями слота product_type (ОГПО ↔ product_type=ogpo). Города из слотов city/region сюда
 * не входят: это не названия продуктов.
 */
const productTerms: Term[] = glossary.terms.filter(
  (t) => t.kind === "acronym" || t.slotValues.some((v) => v.startsWith("product_type=")),
);
const selected = dev.utterances
  .map((u) => ({ ...u, terms: findTerms(u.text, productTerms) }))
  .filter((u) => u.terms.length > 0);

const hints = buildTranscriptionHints(glossary, { model });
const baseline: TranscriptionHints = { model };

const LANGS = ["ru", "kk", "mixed"] as const;
console.log(`Реплик с продуктовыми терминами: ${selected.length} из ${dev.utterances.length} (` +
  LANGS.map((l) => `${l} ${selected.filter((u) => u.lang === l).length}`).join(", ") + ")");

if (values["dry-run"]) {
  for (const u of selected) console.log(`  ${u.id} [${u.lang}] ${u.terms.join(", ")} | ${u.text}`);
  console.log(`\nПодсказка для ${model} (${hints.prompt.length} симв.):\n${JSON.stringify(hints, null, 2)}`);
  process.exit(0);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY не задан (окружение или .env). Без обращений к API: --dry-run");
  process.exit(2);
}

// ---------- API ----------

async function call(pathname: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${pathname}`, { ...init, headers: { Authorization: `Bearer ${apiKey}`, ...init.headers } });
    if (res.ok) return res;
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`${pathname}: HTTP ${res.status} ${await res.text()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

async function synthesize(id: string, text: string): Promise<Buffer> {
  const file = path.join(outDir, "audio", `${id}.mp3`);
  const cached = await readFile(file).catch(() => null);
  if (cached) return cached;
  const res = await call("/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: values["tts-model"], voice: values.voice, input: text, response_format: "mp3" }),
  });
  const audio = Buffer.from(await res.arrayBuffer());
  await writeFile(file, audio);
  return audio;
}

async function transcribe(id: string, audio: Buffer, request: TranscriptionHints): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), `${id}.mp3`);
  for (const [name, value] of toTranscriptionFormFields(request)) form.append(name, value);
  const res = await call("/audio/transcriptions", { method: "POST", body: form });
  return ((await res.json()) as { text: string }).text;
}

// ---------- прогон ----------

interface Row {
  id: string;
  lang: (typeof LANGS)[number];
  text: string;
  terms: string[];
  runs: Record<"baseline" | "hints", { transcript: string; found: string[]; termsOk: boolean; wer: number }>;
}

await mkdir(path.join(outDir, "audio"), { recursive: true });
const rows: Row[] = [];
for (const u of selected) {
  const audio = await synthesize(u.id, u.text);
  const run = async (request: TranscriptionHints) => {
    const transcript = await transcribe(u.id, audio, request);
    const found = findTerms(transcript, productTerms);
    return { transcript, found, termsOk: u.terms.every((t) => found.includes(t)), wer: wordErrorRate(u.text, transcript) };
  };
  const row: Row = { id: u.id, lang: u.lang, text: u.text, terms: u.terms, runs: { baseline: await run(baseline), hints: await run(hints) } };
  rows.push(row);
  console.log(`${u.id} [${u.lang}] без: ${row.runs.baseline.transcript} | с: ${row.runs.hints.transcript}`);
}

// ---------- отчёт ----------

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
function summary(group: Row[], variant: "baseline" | "hints") {
  const termTotal = group.reduce((s, r) => s + r.terms.length, 0);
  const termHit = group.reduce((s, r) => s + r.terms.filter((t) => r.runs[variant].found.includes(t)).length, 0);
  return {
    termsOk: group.filter((r) => r.runs[variant].termsOk).length / group.length,
    termRecall: termHit / termTotal,
    wer: group.reduce((s, r) => s + r.runs[variant].wer, 0) / group.length,
  };
}

const lines = [
  `Модель STT: ${model}, TTS: ${values["tts-model"]} (${values.voice}). Реплик: ${rows.length}.`,
  "",
  "| Язык | n | Термины без искажения: без / с подсказкой | Полнота терминов: без / с | WER: без / с |",
  "|---|---|---|---|---|",
];
for (const lang of [...LANGS, "все"] as const) {
  const group = lang === "все" ? rows : rows.filter((r) => r.lang === lang);
  if (group.length === 0) continue;
  const b = summary(group, "baseline");
  const h = summary(group, "hints");
  lines.push(
    `| ${lang} | ${group.length} | ${pct(b.termsOk)} / ${pct(h.termsOk)} | ${pct(b.termRecall)} / ${pct(h.termRecall)} | ` +
      `${b.wer.toFixed(3)} / ${h.wer.toFixed(3)} |`,
  );
}
const report = lines.join("\n");
console.log(`\n${report}`);
await writeFile(path.join(outDir, "report.md"), `${report}\n`);
await writeFile(path.join(outDir, "results.json"), `${JSON.stringify({ model, hints, rows }, null, 2)}\n`);
console.log(`\nРезультаты: ${path.relative(ROOT, outDir)}/report.md, results.json`);
