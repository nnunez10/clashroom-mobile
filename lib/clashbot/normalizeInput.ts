// lib/clashbot/normalizeInput.ts
//
// Conservative surface-level normalization for user-submitted claim text.
//
// Contract:
//   raw        — verbatim user input (trimmed); always shown in the UI and event log
//   normalized — lightly cleaned version used for API retrieval and family / relevance matching
//
// Hard invariants — these NEVER change:
//   - Numbers, dates, and numeric tokens
//   - Sequences that could be proper nouns (protected by word boundaries + whitelist scope)
//   - Semantic content words — only the closed function-word whitelist is touched
//   - Negation words and sentence meaning

export type NormalizedInput = {
  /** Verbatim user input, trimmed only. Shown in the UI. */
  raw: string;
  /** Surface-cleaned version for API retrieval and family / relevance matching. */
  normalized: string;
};

// ---------------------------------------------------------------------------
// Conservative typo whitelist
//
// Criteria for inclusion:
//   a) 3–4 letter common English function word — cannot plausibly be a proper noun
//   b) Exactly one unambiguous correction, no content-word overlap
//   c) Word-boundary–anchored (see TYPO_RE below) — never fires inside a longer word
// ---------------------------------------------------------------------------
const FUNCTION_WORD_TYPOS: Record<string, string> = {
  teh: "the",
  hte: "the",
  adn: "and",
  nad: "and",
  taht: "that",
  htat: "that",
};

// Case-insensitive, word-boundary–anchored pattern, built once at module load.
const TYPO_RE = new RegExp(
  `\\b(${Object.keys(FUNCTION_WORD_TYPOS).join("|")})\\b`,
  "gi"
);

function applyTypoFixes(text: string): string {
  return text.replace(TYPO_RE, (match) => {
    const fix = FUNCTION_WORD_TYPOS[match.toLowerCase()];
    if (!fix) return match;
    // Preserve the casing style of the original token so sentence-initial
    // capitalisation ("Teh" → "The") and all-caps ("TEH" → "THE") are handled.
    if (match === match.toUpperCase()) return fix.toUpperCase();
    if (match[0] === match[0].toUpperCase()) return fix[0].toUpperCase() + fix.slice(1);
    return fix;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `{ raw, normalized }` for a user-submitted claim string.
 *
 * Normalization steps (all conservative, in order):
 *   1. Collapse repeated whitespace
 *   2. Strip leading/trailing punctuation noise
 *      (hyphens, apostrophes, and period–digit sequences are left untouched)
 *   3. Collapse repeated exclamation / question marks  ("!!!" → "!")
 *   4. Apply function-word transposition typo fixes (closed whitelist only)
 */
export function normalizeClaimInput(text: string): NormalizedInput {
  const raw = String(text || "").trim();
  if (!raw) return { raw, normalized: "" };

  let s = raw;

  // Step 1 — collapse repeated whitespace
  s = s.replace(/\s+/g, " ");

  // Step 2 — strip leading / trailing punctuation noise.
  // Preserves: hyphens (COVID-19), apostrophes (don't), decimal points (3.5%)
  s = s.replace(/^[",!?;:]+/, "").replace(/[",!?;:]+$/, "").trim();

  // Step 3 — collapse repeated end-punctuation
  s = s.replace(/([!?])\1+/g, "$1");

  // Step 4 — function-word typo fixes (whitelist only)
  s = applyTypoFixes(s);

  return { raw, normalized: s };
}

// ---------------------------------------------------------------------------
// Typo suggestion — content-word level only
// Conservative vocabulary: high-signal claim-domain terms only.
// Never auto-applies; caller surfaces the suggestion transparently.
// ---------------------------------------------------------------------------

const CLAIM_VOCABULARY = new Set([
  "flat", "round",        // earth shape claims
  "vaccine", "vaccines",  // immunisation claims
  "autism",               // vaccine/autism claims
  "climate",              // climate claims
  "covid",                // pandemic claims
  "moon",                 // astronomy claims
]);

function editDistance1(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let diffs = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i] && ++diffs > 1) return false;
    }
    return diffs === 1;
  }
  const [shorter, longer] = la < lb ? [a, b] : [b, a];
  for (let i = 0; i <= longer.length - 1; i++) {
    if (shorter === longer.slice(0, i) + longer.slice(i + 1)) return true;
  }
  return false;
}

/**
 * Returns a corrected claim string if exactly ONE token is a likely content-word
 * typo (edit distance 1 from a known vocabulary term), or null otherwise.
 * Does NOT auto-apply — caller is responsible for transparent opt-in surfacing.
 */
export function suggestTypoCorrection(text: string): string | null {
  const tokens = String(text || "").trim().split(/\s+/);
  let changedIdx = -1;
  let changedWord = "";
  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();
    if (CLAIM_VOCABULARY.has(lower)) continue;
    for (const word of CLAIM_VOCABULARY) {
      if (editDistance1(lower, word)) {
        if (changedIdx !== -1) return null; // >1 token would change — no suggestion
        changedIdx = i;
        changedWord = word;
        break;
      }
    }
  }
  if (changedIdx === -1) return null;
  const fixed = [...tokens];
  fixed[changedIdx] = changedWord;
  return fixed.join(" ");
}
