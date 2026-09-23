import { fold, words } from "./text.ts";

export { findTerms } from "./text.ts";

/** Слова для сравнения транскриптов: нижний регистр, «ё» как «е», без пунктуации. */
export function normalizeWords(text: string): string[] {
  return words(text).map(fold);
}

/** Word error rate: (замены + вставки + удаления) / число слов эталона. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const row = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      row.push(Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost));
    }
    prev = row;
  }
  return (prev[hyp.length] ?? 0) / ref.length;
}
