// lib/clashbot/evidenceClustering.ts
//
// Pure evidence deduplication — groups provider matches into clusters of
// identical, paraphrased, or syndicated evidence. Conservative: when
// uncertain whether two items are independent, they are merged.
//
// No React, no state, no side effects.

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface MatchFingerprint {
  match: any;
  ratingKey: string;
  fullUrl: string;
  urlHost: string;
  sourceFam: "override" | "factcheck" | "news" | "unknown";
  titleTokens: string[];
  qualityScore: number;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EvidenceCluster {
  /** Highest-quality match in this cluster. Use this for scoring. */
  representative: any;
  /** All members, including the representative. */
  members: any[];
  /** True when the cluster has more than one member (duplicates were merged). */
  hasDuplicates: boolean;
}

export interface ClusteringResult {
  clusters: EvidenceCluster[];
  /** Total raw matches passed in. */
  totalMatches: number;
  /** Number of independent clusters — use instead of raw match count for scoring. */
  representativeCount: number;
  /** Matches absorbed into an existing cluster (raw - representative). */
  duplicateCount: number;
}

// ---------------------------------------------------------------------------
// Helpers (self-contained — no imports from verificationService to avoid
// circular dependency; safeString and qualityScore are duplicated here)
// ---------------------------------------------------------------------------

function safe(x: any): string {
  return typeof x === "string" ? x : "";
}

const CLUSTER_STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than",
  "is", "are", "was", "were", "be", "been", "of", "to", "in",
  "on", "at", "for", "from", "with", "about", "this", "that",
  "it", "as", "by", "says", "say", "claim", "claims", "did", "not",
]);

function normalizeRating(text: string | undefined): string {
  return safe(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleTokens(raw: string | undefined): string[] {
  return safe(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !CLUSTER_STOP.has(t));
}

function extractUrlHost(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractSourceFam(provider: string): MatchFingerprint["sourceFam"] {
  if (provider === "known_fact_override") return "override";
  if (provider === "google_factcheck") return "factcheck";
  if (provider === "newsapi" || provider === "bing_news") return "news";
  return "unknown";
}

function computeQualityScore(m: any): number {
  const p = safe(m?.provider);
  let s = 0;
  if (p === "known_fact_override") s += 60;
  else if (p === "google_factcheck") s += 40;
  else if (p === "newsapi" || p === "bing_news") s += 20;
  if (safe(m?.rating?.text)) s += 10;
  if (safe(m?.url)) s += 5;
  if (safe(m?.publisher)) s += 3;
  if (safe(m?.title)) s += 2;
  return s;
}

/** |intersection| / max(|A|, |B|). Returns 1 when both arrays are empty. */
function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const t of a) if (setB.has(t)) shared++;
  return shared / Math.max(a.length, b.length);
}

function buildFingerprint(m: any): MatchFingerprint {
  const titleSource = m?.title ?? m?.claimReviewed ?? m?.claim ?? "";
  const rawUrl = safe(m?.url);
  return {
    match: m,
    ratingKey: normalizeRating(m?.rating?.text),
    fullUrl: rawUrl,
    urlHost: extractUrlHost(rawUrl),
    sourceFam: extractSourceFam(safe(m?.provider)),
    titleTokens: extractTitleTokens(titleSource),
    qualityScore: computeQualityScore(m),
  };
}

/**
 * Conservative cluster membership test.
 * Returns true if `candidate` should be merged into a cluster whose
 * representative is `rep`. Bias toward merging — if uncertain, merge.
 *
 * Rules (checked in order, first match wins):
 *   Rule 0 — Exact same non-empty URL + same verdict → definite duplicate (same page).
 *   Rule 1 — Same hostname + same verdict + title overlap ≥ 50% (or both untitled)
 *             → probable duplicate (same article under different query params / slugs).
 *   Rule 2 — Same source family + same verdict + title overlap ≥ 50%
 *             → near-duplicate (paraphrase / syndicate, same outlet + verdict).
 *   Rule 3 — Title overlap ≥ 70% across any providers
 *             → syndicated wire-service content.
 *             Exception: two items with explicit, conflicting verdicts are NOT merged
 *             (one may say "True", another "False" — that is genuine conflict, not duplication).
 */
function sameCluster(rep: MatchFingerprint, candidate: MatchFingerprint): boolean {
  // Rule 0 — Exact same non-empty URL + same verdict = definite duplicate.
  if (
    rep.fullUrl &&
    candidate.fullUrl &&
    rep.fullUrl === candidate.fullUrl &&
    rep.ratingKey === candidate.ratingKey
  ) {
    return true;
  }

  // Rule 1 — Same hostname + same verdict + title overlap (or both untitled).
  // Two different articles from the same fact-checking site on different topics
  // must NOT merge: title overlap is required as a topic anchor.
  if (
    rep.urlHost &&
    candidate.urlHost &&
    rep.urlHost === candidate.urlHost &&
    rep.ratingKey === candidate.ratingKey
  ) {
    const bothTitleless = rep.titleTokens.length === 0 && candidate.titleTokens.length === 0;
    const overlap = tokenOverlap(rep.titleTokens, candidate.titleTokens);
    const hasEnoughTitle = rep.titleTokens.length >= 2 || candidate.titleTokens.length >= 2;
    if (bothTitleless || (overlap >= 0.5 && hasEnoughTitle)) return true;
  }

  // Rule 2 — Same source family + same verdict + sufficient title overlap.
  if (rep.sourceFam === candidate.sourceFam && rep.ratingKey === candidate.ratingKey) {
    const overlap = tokenOverlap(rep.titleTokens, candidate.titleTokens);
    const bothHaveTitle = rep.titleTokens.length >= 2 || candidate.titleTokens.length >= 2;
    if (overlap >= 0.5 && bothHaveTitle) return true;
  }

  // Rule 3 — Very high title overlap = syndicated / wire-service content.
  // Exception: explicit conflicting ratings signal genuine disagreement, not duplication.
  const explicitConflict =
    rep.ratingKey !== "" && candidate.ratingKey !== "" && rep.ratingKey !== candidate.ratingKey;
  if (!explicitConflict && rep.titleTokens.length >= 3 && candidate.titleTokens.length >= 3) {
    if (tokenOverlap(rep.titleTokens, candidate.titleTokens) >= 0.7) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Groups raw provider matches into evidence clusters.
 *
 * Matches are sorted by quality descending before clustering, so the first
 * element of each group (the representative) is always the best available
 * evidence item. Callers should use `representativeCount` instead of
 * `totalMatches` when computing how many independent sources support a stance.
 */
export function clusterEvidence(matches: any[] | undefined): ClusteringResult {
  const list = Array.isArray(matches) ? matches : [];
  if (list.length === 0) {
    return { clusters: [], totalMatches: 0, representativeCount: 0, duplicateCount: 0 };
  }

  // Sort best-first so the first member of each group is the representative.
  const fps = list.map(buildFingerprint).sort((a, b) => b.qualityScore - a.qualityScore);

  const groups: MatchFingerprint[][] = [];

  for (const fp of fps) {
    let merged = false;
    for (const group of groups) {
      if (sameCluster(group[0], fp)) {
        group.push(fp);
        merged = true;
        break;
      }
    }
    if (!merged) groups.push([fp]);
  }

  const clusters: EvidenceCluster[] = groups.map((group) => ({
    representative: group[0].match,
    members: group.map((fp) => fp.match),
    hasDuplicates: group.length > 1,
  }));

  return {
    clusters,
    totalMatches: list.length,
    representativeCount: clusters.length,
    duplicateCount: list.length - clusters.length,
  };
}
