/**
 * Сборка словаря терминов для распознавания речи из стартового набора (issue #8).
 *
 *   pnpm glossary:build                       # набор из data/kit (или из KIT_DIR)
 *   pnpm glossary:build --kit <каталог>        # набор из другого каталога
 *   pnpm glossary:build --check                # проверить, что артефакт соответствует данным
 *
 * Результат — packages/core/src/stt/stt-glossary.json. Сборка детерминирована: те же данные дают
 * тот же файл байт в байт, поэтому артефакт хранится в репозитории и проверяется в --check.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildGlossary, parseKit } from "../packages/core/src/stt/glossary.ts";

const ROOT = path.join(import.meta.dirname, "..");
export const GLOSSARY_PATH = path.join(ROOT, "packages/core/src/stt/stt-glossary.json");

const { values } = parseArgs({
  options: {
    kit: { type: "string" },
    out: { type: "string" },
    check: { type: "boolean", default: false },
  },
});

const kitDir = path.resolve(values.kit ?? process.env.KIT_DIR ?? path.join(ROOT, "data/kit"));
const outPath = path.resolve(values.out ?? GLOSSARY_PATH);

async function readKitFile(name: string): Promise<{ json: unknown; sha256: string }> {
  const file = path.join(kitDir, name);
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch {
    throw new Error(
      `${file} не найден. Стартовый набор кладётся в data/kit (#3); другой каталог: --kit <путь> или KIT_DIR.`,
    );
  }
  return { json: JSON.parse(raw.toString("utf8")), sha256: createHash("sha256").update(raw).digest("hex") };
}

const scenarios = await readKitFile("scenarios.json");
const slots = await readKitFile("slots.json");
const glossary = buildGlossary(parseKit(scenarios.json, slots.json));
glossary.source.sha256 = { "scenarios.json": scenarios.sha256, "slots.json": slots.sha256 };
const content = `${JSON.stringify(glossary, null, 2)}\n`;

if (values.check) {
  const current = await readFile(outPath, "utf8").catch(() => "");
  if (current !== content) {
    console.error(`${path.relative(ROOT, outPath)} не соответствует данным набора — пересоберите: pnpm glossary:build`);
    process.exit(1);
  }
  console.log(`${path.relative(ROOT, outPath)} соответствует данным набора`);
} else {
  await writeFile(outPath, content);
  console.log(`Словарь: ${path.relative(ROOT, outPath)}`);
}

console.log(
  `терминов ${glossary.terms.length} (ru ${glossary.ru.length}, kk ${glossary.kk.length}, общих ${glossary.shared.length}), ` +
    `форматов номеров ${glossary.identifiers.length}, фраз ${glossary.phrases.length}`,
);
console.log(`первые по важности: ${glossary.terms.slice(0, 15).map((t) => t.term).join(", ")}`);
