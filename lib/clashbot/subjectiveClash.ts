// lib/clashbot/subjectiveClash.ts
//
// Lightweight heuristics for detecting and inverting subjective/opinion claims.
// No ML — string pattern matching only.

const SUBJECTIVE_PATTERNS = [
  "better than",
  "worse than",
  "is the best",
  "is the worst",
  "superior to",
  "inferior to",
  "more important than",
  "less important than",
  "greatest of all time",
  "goat",
  "g.o.a.t",
];

export function isSubjectiveClaim(text: string): boolean {
  const lower = text.toLowerCase();
  return SUBJECTIVE_PATTERNS.some((p) => lower.includes(p));
}

export function invertSubjectiveClaim(text: string): string {
  const t = text.trim();

  // "A is better than B" → "B is better than A"
  const betterIs = t.match(/^(.+?)\s+is\s+better\s+than\s+(.+)$/i);
  if (betterIs) {
    return `${betterIs[2].trim()} is better than ${betterIs[1].trim()}`;
  }

  // "A better than B" (no copula)
  const better = t.match(/^(.+?)\s+better\s+than\s+(.+)$/i);
  if (better) {
    return `${better[2].trim()} is better than ${better[1].trim()}`;
  }

  // "A is worse than B" → "B is worse than A"
  const worseIs = t.match(/^(.+?)\s+is\s+worse\s+than\s+(.+)$/i);
  if (worseIs) {
    return `${worseIs[2].trim()} is worse than ${worseIs[1].trim()}`;
  }

  // "A worse than B"
  const worse = t.match(/^(.+?)\s+worse\s+than\s+(.+)$/i);
  if (worse) {
    return `${worse[2].trim()} is worse than ${worse[1].trim()}`;
  }

  // "A is superior to B" → "B is superior to A"
  const superior = t.match(/^(.+?)\s+is\s+superior\s+to\s+(.+)$/i);
  if (superior) {
    return `${superior[2].trim()} is superior to ${superior[1].trim()}`;
  }

  // "A is inferior to B" → "B is inferior to A"
  const inferior = t.match(/^(.+?)\s+is\s+inferior\s+to\s+(.+)$/i);
  if (inferior) {
    return `${inferior[2].trim()} is inferior to ${inferior[1].trim()}`;
  }

  // "A is the best [...]" → "A is not the best [...]"
  const best = t.match(/^(.+?)\s+is\s+the\s+best(.*)$/i);
  if (best) {
    return `${best[1].trim()} is not the best${best[2]}`;
  }

  // "A is the worst [...]" → "A is not the worst [...]"
  const worst = t.match(/^(.+?)\s+is\s+the\s+worst(.*)$/i);
  if (worst) {
    return `${worst[1].trim()} is not the worst${worst[2]}`;
  }

  // Fallback
  return "Some people disagree with this claim";
}
