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
  "not",
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
]);

function normalizeWhitespace(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function normalizeClaimText(text: string) {
  return normalizeWhitespace(
    String(text || "")
      .toLowerCase()
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
  return tokenizeClaimText(text).filter(
    (token) => token.length >= 3 && !DNA_STOPWORDS.has(token)
  );
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
 * removes stopwords, sorts remaining tokens.
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

export function areClaimsInSameFamily(a: string, b: string) {
  const dnaA = getClaimDna(a);
  const dnaB = getClaimDna(b);

  if (!dnaA.familyFingerprint || !dnaB.familyFingerprint) return false;
  if (dnaA.familyFingerprint === dnaB.familyFingerprint) return true;

  const setB = new Set(dnaB.meaningfulTokens);
  let shared = 0;

  for (const token of dnaA.meaningfulTokens) {
    if (setB.has(token)) shared++;
  }

  const minSize = Math.max(
    1,
    Math.min(dnaA.meaningfulTokens.length, dnaB.meaningfulTokens.length)
  );

  const overlap = shared / minSize;

  return shared >= 2 || overlap >= 0.75;
}