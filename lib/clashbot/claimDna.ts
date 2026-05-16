// lib/clashbot/claimDna.ts

const DNA_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "from",
  "with",
  "about",
  "this",
  "that",
  "it",
  "as",
  "by",
  "you",
  "your",
  "we",
  "they",
  "he",
  "she",
  "i",
  "me",
  "my",
  "our",
  "their",
  // "not" intentionally excluded: it inverts proposition truth value and must
  // be preserved in family tokens so "X causes Y" and "X does not cause Y"
  // receive different familyIds and are never silently merged or blocked.
  "no",
  "yes",
  "up",
  "down",
  "over",
  "under",
  "really",
  "actually",
  "basically",
  "literally",
  "just",
  "still",
  "even",
  "very",
  "more",
  "most",
  "less",
  "least",
  "can",
  "could",
  "should",
  "would",
  "do",
  "does",
  "did",
  "will",
]);

function normalizeWhitespace(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeToken(token: string) {
  let next = normalizeWhitespace(String(token || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (!next) return "";

  // Small conservative stemming only.
  if (next.endsWith("ation") && next.length > 7) {
    next = next.slice(0, -5);
  } else if (next.endsWith("tion") && next.length > 6) {
    next = next.slice(0, -4);
  } else if (next.endsWith("ing") && next.length > 5) {
    next = next.slice(0, -3);
  } else if (next.endsWith("ed") && next.length > 4) {
    next = next.slice(0, -2);
  } else if (next.endsWith("es") && next.length > 4) {
    next = next.slice(0, -2);
  } else if (next.endsWith("s") && next.length > 3) {
    next = next.slice(0, -1);
  }

  if (next.endsWith("e") && next.length > 5) {
    next = next.slice(0, -1);
  }

  return next;
}

function tokenSetOverlap(a: string[], b: string[]) {
  const bSet = new Set(b);
  let shared = 0;

  for (const token of a) {
    if (bSet.has(token)) shared++;
  }

  const union = new Set([...a, ...b]).size;
  if (union === 0) return 0;

  return shared / union;
}

function tokenSetContainment(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;

  const bSet = new Set(b);
  let shared = 0;

  for (const token of a) {
    if (bSet.has(token)) shared++;
  }

  return shared / Math.min(a.length, b.length);
}

export function normalizeClaimText(text: string) {
  return normalizeWhitespace(
    String(text || "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
  );
}

export function tokenizeClaimText(text: string) {
  return normalizeClaimText(text)
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function meaningfulClaimTokens(text: string) {
  const normalized = tokenizeClaimText(text)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= 3 && !DNA_STOPWORDS.has(token));

  return Array.from(new Set(normalized));
}

/**
 * Exact-ish fingerprint:
 * preserves token order after normalization.
 * Good for deduping repeated identical or near-identical inputs.
 */
export function getClaimFingerprint(text: string) {
  return normalizeClaimText(text);
}

/**
 * Family fingerprint:
 * removes stopwords, normalizes token variants, sorts remaining tokens.
 * Good for grouping paraphrases with similar core wording.
 */
export function getClaimFamilyFingerprint(text: string) {
  const tokens = meaningfulClaimTokens(text);
  const uniqueSorted = Array.from(new Set(tokens)).sort();
  return uniqueSorted.join("|");
}

function hashString(input: string) {
  const text = String(input || "");
  let hash = 2166136261;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function buildClaimFamilyId(text: string) {
  const familyFingerprint = getClaimFamilyFingerprint(text);
  if (!familyFingerprint) return `cfam_${hashString(getClaimFingerprint(text))}`;
  return `cfam_${hashString(familyFingerprint)}`;
}

export function buildClaimNodeId(text: string) {
  return `claim_${hashString(getClaimFingerprint(text))}`;
}

export function getClaimDna(text: string) {
  const normalized = normalizeClaimText(text);
  const tokens = tokenizeClaimText(text);
  const meaningfulTokensList = meaningfulClaimTokens(text);
  const fingerprint = getClaimFingerprint(text);
  const familyFingerprint = getClaimFamilyFingerprint(text);

  return {
    normalized,
    tokens,
    meaningfulTokens: meaningfulTokensList,
    fingerprint,
    familyFingerprint,
    familyId: buildClaimFamilyId(text),
    nodeId: buildClaimNodeId(text),
  };
}

// Matches contracted and expanded negation markers.
// Used to guard against proposition-inverting claims being merged into the
// same family — e.g. "vaccines cause autism" vs "vaccines do not cause autism".
const NEGATION_RE =
  /\b(not|never|neither|nor|nobody|nothing|nowhere|don'?t|doesn'?t|didn'?t|won'?t|can'?t|couldn'?t|wouldn'?t|shouldn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|haven'?t|hasn'?t|hadn'?t)\b/i;

function hasNegation(text: string): boolean {
  return NEGATION_RE.test(String(text || ""));
}

// ── Directional-flip guard ────────────────────────────────────────────────────
// Tier-1 only: clear asymmetric transitive verbs where swapping subject and
// object produces a different real-world outcome ("Lakers beat Warriors" vs
// "Warriors beat Lakers"). Causal verbs (caused, led to) and "lost to" are
// deferred due to passive-voice and causation complexity.
const DIRECTIONAL_VERB_PHRASES: string[][] = [
  ["beat"],
  ["defeated"],
  ["bought"],
  ["sold"],
  ["endorsed"],
  ["appointed"],
  ["sued"],
  ["killed"],
  ["invaded"],
];

// When these tokens are present, the syntactic subject/object inversion is
// structural (passive voice), not semantic. Skip the directional check so
// "Warriors were beaten by Lakers" still groups with "Lakers beat Warriors".
const PASSIVE_TOKENS = new Set(["was", "were", "been", "being", "by"]);

function findVerbPosition(tokens: string[], verbWords: string[]): number {
  // eslint-disable-next-line no-labels
  outer: for (let i = 0; i <= tokens.length - verbWords.length; i++) {
    for (let j = 0; j < verbWords.length; j++) {
      // eslint-disable-next-line no-labels
      if (tokens[i + j] !== verbWords[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function extractMeaningful(tokens: string[]): string[] {
  return tokens
    .map(normalizeToken)
    .filter((t) => t.length >= 3 && !DNA_STOPWORDS.has(t));
}

function isDirectionalFlip(a: string, b: string): boolean {
  const tokA = tokenizeClaimText(a);
  const tokB = tokenizeClaimText(b);

  // Passive constructions legitimately invert syntactic subject/object;
  // skip the directional check and let the overlap logic decide.
  if (tokA.some((t) => PASSIVE_TOKENS.has(t)) || tokB.some((t) => PASSIVE_TOKENS.has(t))) {
    return false;
  }

  for (const verbWords of DIRECTIONAL_VERB_PHRASES) {
    const posA = findVerbPosition(tokA, verbWords);
    const posB = findVerbPosition(tokB, verbWords);
    if (posA === -1 || posB === -1) continue;

    const beforeA = extractMeaningful(tokA.slice(0, posA));
    const afterA  = extractMeaningful(tokA.slice(posA + verbWords.length));
    const beforeB = extractMeaningful(tokB.slice(0, posB));
    const afterB  = extractMeaningful(tokB.slice(posB + verbWords.length));

    // Fail-safe: if any side has no meaningful tokens (subject/object is
    // entirely stopwords or too short), skip rather than misfire.
    if (!beforeA.length || !afterA.length || !beforeB.length || !afterB.length) continue;

    const subjectMatch = tokenSetOverlap(beforeA, afterB) >= 0.5;
    const objectMatch  = tokenSetOverlap(afterA,  beforeB) >= 0.5;
    if (subjectMatch && objectMatch) return true;
  }
  return false;
}

export function areClaimsInSameFamily(a: string, b: string) {
  const dnaA = getClaimDna(a);
  const dnaB = getClaimDna(b);

  if (!dnaA.normalized || !dnaB.normalized) return false;

  // Claims that differ in negation polarity are contradictions, not paraphrases.
  // Keep them in separate families so neither blocks the other from being verified.
  if (hasNegation(a) !== hasNegation(b)) return false;

  if (dnaA.normalized === dnaB.normalized) return true;

  // Claims where subject and object are swapped around a directional verb are
  // different propositions, not paraphrases.
  if (isDirectionalFlip(a, b)) return false;

  if (dnaA.familyFingerprint && dnaA.familyFingerprint === dnaB.familyFingerprint) {
    return true;
  }

  if (!dnaA.meaningfulTokens.length || !dnaB.meaningfulTokens.length) return false;

  const overlap = tokenSetOverlap(dnaA.meaningfulTokens, dnaB.meaningfulTokens);
  const containment = tokenSetContainment(dnaA.meaningfulTokens, dnaB.meaningfulTokens);

  const setB = new Set(dnaB.meaningfulTokens);
  let shared = 0;

  for (const token of dnaA.meaningfulTokens) {
    if (setB.has(token)) shared++;
  }

  if (overlap >= 0.72) return true;
  if (shared >= 2 && containment >= 0.8) return true;

  return false;
}