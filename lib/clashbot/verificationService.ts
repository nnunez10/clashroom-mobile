// lib/clashbot/verificationService.ts
//
// Pure orchestration logic extracted verbatim from useMockClashBotEngine.ts.
// No React, no state, no effects.
//
// Types come from their canonical owners:
//   lib/clashbot/types.ts  → raw provider result shapes (FactCheckMatch)
//   lib/claim/types.ts     → domain types (Stance, RelevanceAssessment, EvidenceRecord)
//
// Re-exports the three domain types so callers can import from one place.

import type { FactCheckMatch } from "./types";
import { findKnownFactOverride } from "./knownFacts";
import type { ConfidenceTier, EvidenceRecord, ReasonCode, RelevanceAssessment, Stance } from "../claim/types";
import { clusterEvidence } from "./evidenceClustering";

export type { ConfidenceTier, EvidenceRecord, ReasonCode, RelevanceAssessment, Stance };

// ---------------------------------------------------------------------------
// Utilities — exported so useMockClashBotEngine can re-import them.
// (appendClaimEvent needs makeId; engine body needs safeString.)
// ---------------------------------------------------------------------------

export function safeString(x: any): string {
  return typeof x === "string" ? x : "";
}

export function makeId(prefix: string, seed?: string): string {
  const base = String(seed || `${Date.now()}_${Math.random()}`);
  let hash = 2166136261;

  for (let i = 0; i < base.length; i++) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

// ---------------------------------------------------------------------------
// NLP helpers — private to this module
// ---------------------------------------------------------------------------

function tokenizeLower(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const STOP = new Set([
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
]);

const CONTRADICTION_PHRASES = [
  "false",
  "not true",
  "incorrect",
  "inaccurate",
  "misleading",
  "debunked",
  "no evidence",
  "lacks evidence",
  "without evidence",
  "fact check false",
  "fact-check false",
  "fact check: false",
  "fact-check: false",
  "pants on fire",
  "wrong",
  "hoax",
  "myth",
  "refuted",
  "contradicted",
];

const SUPPORT_PHRASES = [
  "true",
  "correct",
  "accurate",
  "confirmed",
  "supported by data",
  "supported by evidence",
  "verified",
  "fact check true",
  "fact-check true",
  "fact check: true",
  "fact-check: true",
  "mostly true",
  "supported",
];

// Negation words filtered out by meaningfulTokens (stop words / short tokens).
// Used separately to detect polarity flips between user claim and reviewed claim.
const NEGATION_RE = /\b(not|no|never|cannot|can't|doesn't|don't|isn't|aren't|wasn't|weren't|won't)\b/i;

function meaningfulTokens(s: string): string[] {
  return tokenizeLower(s).filter((t) => t.length >= 4 && !STOP.has(t));
}

function extractNumbers(s: string): string[] {
  const text = String(s || "");
  const matches = text.match(/(\$?\d[\d,]*(?:\.\d+)?%?)/g) || [];
  return matches.map((m) => m.replace(/,/g, "").toLowerCase());
}

function extractNamedEntitiesHeuristic(s: string): string[] {
  const text = String(s || "");
  const entities = new Set<string>();

  // Tier 1 — All-caps acronyms (NASA, COVID, FBI, DNA).
  // Reliable proper nouns regardless of position.
  for (const m of text.match(/\b([A-Z]{2,})\b/g) || []) {
    entities.add(m.toLowerCase());
  }

  // Tier 2 — Multi-word title-case phrases (Great Barrier Reef, Steve Jobs, Federal Reserve).
  // Requiring ≥2 consecutive title-case words makes sentence-start ambiguity irrelevant:
  // a sentence will rarely start with two consecutive proper nouns by convention.
  for (const m of text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g) || []) {
    entities.add(m.toLowerCase());
  }

  // Tier 3 — Single title-case words in non-sentence-initial positions only.
  //
  // Words that appear *exclusively* at sentence-initial positions are likely
  // conventional sentence capitalization ("Regular aspirin...", "Exercise reduces..."),
  // not genuine proper nouns.  Accept a sentence-initial word only if it also appears
  // capitalized mid-sentence — confirming it is a proper noun used in both contexts.
  //
  // Sentence-initial = very start of text or immediately after [.?!] + whitespace.
  const sentenceStarts = new Set<string>();
  for (const raw of text.match(/(?:^|[.?!]\s+)([A-Z][a-z]+)\b/g) || []) {
    const word = raw.replace(/^[^A-Za-z]+/, "");
    sentenceStarts.add(word.toLowerCase());
  }

  for (const m of text.match(/\b([A-Z][a-z]+)\b/g) || []) {
    const lower = m.toLowerCase();
    if (lower.length < 3 || STOP.has(lower)) continue;

    if (!sentenceStarts.has(lower)) {
      // Appears capitalized only in non-sentence-initial positions → proper noun.
      entities.add(lower);
    } else {
      // Appears at a sentence-initial position. Accept only if it also appears
      // capitalized mid-sentence (totalCount > sentence-initial count).
      const totalCount = (text.match(new RegExp(`\\b${m}\\b`, "g")) || []).length;
      const startCount = (text.match(new RegExp(`(?:^|[.?!]\\s+)${m}\\b`, "g")) || []).length;
      if (totalCount > startCount) entities.add(lower);
    }
  }

  return Array.from(entities);
}

function setOverlapCount(a: string[], b: string[]): number {
  const setB = new Set(b);
  let shared = 0;
  for (const t of a) {
    if (setB.has(t)) shared++;
  }
  return shared;
}

function countPhraseHits(text: string, phrases: string[]): number {
  const hay = String(text || "").toLowerCase();
  let hits = 0;
  for (const phrase of phrases) {
    if (hay.includes(phrase)) hits++;
  }
  return hits;
}

function domainFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

function providerRank(provider: string): number {
  if (provider === "known_fact_override") return 0;
  if (provider === "google_factcheck") return 1;
  if (provider === "bing_news" || provider === "newsapi") return 2;
  return 3;
}

function matchQualityScore(m: any): number {
  const provider = safeString(m?.provider) || "unknown";
  let score = (3 - providerRank(provider)) * 20;
  if (safeString(m?.rating?.text)) score += 10;
  else if (provider === "bing_news" || provider === "newsapi") score -= 10; // coverage without verdict = weak signal
  if (safeString(m?.url)) score += 5;
  if (safeString(m?.publisher)) score += 3;
  if (safeString(m?.title)) score += 2;
  return score;
}

// Claim-aware match scorer: extends matchQualityScore with token-overlap relevance
// and source recency. Used when claimText is available so the best `top` result
// is the one most directly about the claim, not just the most authoritative source.
//
// Relevance bonus: up to +20 (4 pts per shared meaningful token, capped)
// Recency bonus:   +10 today, +7 within a week, +4 within a month, +2 within a year
function scoreMatchForClaim(claimText: string, m: any): number {
  let score = matchQualityScore(m);

  // Relevance: token overlap between claim and all text fields on the match
  const matchText = [
    safeString(m?.claim),
    safeString(m?.claimReviewed),
    safeString(m?.title),
    safeString(m?.text),
    safeString(m?.snippet),
  ].filter(Boolean).join(" ");
  const claimTokens = meaningfulTokens(claimText);
  const matchTokens = meaningfulTokens(matchText);
  if (claimTokens.length > 0 && matchTokens.length > 0) {
    const overlap = setOverlapCount(claimTokens, matchTokens);
    score += Math.min(overlap * 4, 20);
  }

  // Recency: newer sources score higher.
  // Weights are doubled vs. the old values so that a same-day, fully-relevant
  // news article can compete with an older authoritative source (provider gap
  // between google_factcheck and newsapi is ~20 pts; old max was only +10).
  const claimDate = safeString(m?.claimDate);
  if (claimDate) {
    const ms = Date.parse(claimDate);
    if (Number.isFinite(ms)) {
      const ageDays = Math.floor((Date.now() - ms) / 86_400_000);
      if (ageDays === 0)       score += 20; // was 10 — strong
      else if (ageDays <= 7)   score += 14; // was  7 — high
      else if (ageDays <= 30)  score +=  8; // was  4 — medium
      else if (ageDays <= 365) score +=  4; // was  2 — minimal
    }
  }

  return score;
}

function pickTopMatch(matches: any[] | undefined, claimText?: string): any | undefined {
  if (!Array.isArray(matches) || matches.length === 0) return undefined;
  const scoreFn = claimText
    ? (m: any) => scoreMatchForClaim(claimText, m)
    : matchQualityScore;
  return [...matches].sort((a, b) => scoreFn(b) - scoreFn(a))[0];
}

function normalizeMode(
  mode: string | undefined
): "factcheck" | "news" | "override" | undefined {
  if (mode === "fact_check" || mode === "factcheck") return "factcheck";
  if (mode === "recent_coverage" || mode === "news") return "news";
  if (mode === "override") return "override";
  return undefined;
}

function normalizeEvidenceKind(
  provider?: string,
  mode?: string
): EvidenceRecord["kind"] {
  if (provider === "known_fact_override") return "override";
  const m = normalizeMode(mode);
  if (m === "factcheck" || provider === "google_factcheck") return "fact_check";
  if (m === "news" || provider === "bing_news" || provider === "newsapi") {
    return "coverage";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Exported orchestration functions — moved verbatim from engine
// ---------------------------------------------------------------------------

export function buildCandidateText(result: any, top: any): string {
  return [
    safeString(top?.claim),
    safeString(top?.claimReviewed),
    safeString(top?.title),
    safeString(top?.text),
    safeString(top?.snippet),
    safeString(top?.publisher),
    safeString(top?.rating?.text),
    safeString(result?.message),
  ]
    .filter(Boolean)
    .join(" ");
}

export function assessRelevance(
  claimText: string,
  matchText: string,
  mode?: "fact_check" | "recent_coverage"
): RelevanceAssessment {
  const claimNums = extractNumbers(claimText);
  const matchNums = extractNumbers(matchText);

  const claimEnts = extractNamedEntitiesHeuristic(claimText);
  const matchEnts = extractNamedEntitiesHeuristic(matchText);

  const sharedNums = setOverlapCount(claimNums, matchNums);
  const sharedEnts = setOverlapCount(claimEnts, matchEnts);

  const hasAnchors = claimNums.length > 0 || claimEnts.length > 0;

  if (hasAnchors) {
    // recent_coverage entity gate: if the claim names a person, organization, or
    // other entity, the article must mention that entity. A shared number alone
    // (e.g. a year, a percentage that coincidentally matches) is not sufficient —
    // the article could be about a completely different event or actor.
    if (mode === "recent_coverage" && claimEnts.length > 0) {
      const matchToks = new Set(meaningfulTokens(matchText));
      const entityShared =
        sharedEnts >= 1 ||
        claimEnts.some((e) =>
          e.split(/\s+/).filter(Boolean).every((w) => matchToks.has(w))
        );
      if (!entityShared) {
        return {
          relevant: false,
          reason: "Recent coverage does not mention the key entity in the claim.",
        };
      }
    }

    if (sharedNums >= 1 || sharedEnts >= 1) {
      return {
        relevant: true,
        reason: "Source shares a key entity or number with the claim.",
      };
    }

    // Entity/number anchors present but no direct entity-list overlap found.
    // Final check: do claim entity words appear in the match's token set?
    // This handles the asymmetric case where an entity extracted mid-sentence in
    // the claim appears at sentence-start in the match text (and is therefore not
    // in matchEnts due to the sentence-initial capitalization filter).
    if (claimEnts.length > 0) {
      const matchToks = new Set(meaningfulTokens(matchText));
      const entityInTokens = claimEnts.some((e) =>
        e.split(/\s+/).filter(Boolean).every((w) => matchToks.has(w))
      );
      if (entityInTokens) {
        return {
          relevant: true,
          reason: "Source shares a key entity with the claim.",
        };
      }
    }

    return {
      relevant: false,
      reason: "Returned source does not share a key entity or number with the claim.",
    };
  }

  const a = meaningfulTokens(claimText);
  const b = meaningfulTokens(matchText);

  if (a.length === 0 || b.length === 0) {
    return {
      relevant: false,
      reason: "Not enough meaningful overlap to verify relevance.",
    };
  }

  const shared = setOverlapCount(a, b);
  const overlap = shared / Math.max(1, Math.min(a.length, b.length));

  if (mode === "recent_coverage") {
    // Stricter than fact_check: no named-entity anchor means the claim is
    // likely dynamic/current-event, so generic token coincidence is high-risk.
    // Require ≥3 shared tokens OR ≥30% overlap (up from 2 / 18%).
    if (shared >= 3 || overlap >= 0.30) {
      return {
        relevant: true,
        reason: "Recent coverage appears meaningfully related to the claim.",
      };
    }

    return {
      relevant: false,
      reason: "Recent coverage found, but it appears only loosely related.",
    };
  }

  if (shared >= 2 || overlap >= 0.22) {
    return {
      relevant: true,
      reason: "Source text is meaningfully related to the claim.",
    };
  }

  return {
    relevant: false,
    reason: "Returned source appears related, but relevance is weak.",
  };
}

export function mergeVerificationMessage(result: any, extra: string): string {
  const prior = safeString(result?.message).trim();
  if (!prior) return extra;
  if (prior.includes(extra)) return prior;
  return `${prior} ${extra}`.trim();
}

export function classifyClaimStance(
  claimText: string,
  matchText: string,
  result: any
): Stance {
  // ---------------------------------------------------------------------------
  // Phase 1: aggregate per-match rating votes across all available matches.
  // Google fact-check / known-fact ratings are weighted 2; news coverage 1.
  // This replaces the previous approach of examining only matches[0].rating.
  // ---------------------------------------------------------------------------
  const matches: any[] = Array.isArray(result?.matches) ? result.matches : [];
  let contradictionScore = 0;
  let supportScore = 0;
  const userMeaningfulTokens = new Set(meaningfulTokens(claimText));

  for (const m of matches) {
    const ratingText = safeString(m?.rating?.text).toLowerCase();
    if (!ratingText) continue;
    const weight =
      m?.provider === "google_factcheck" || m?.provider === "known_fact_override" ? 3 : 1;

    // Polarity check: if the fact-checked claim is the contrary proposition to the user's
    // claim — same subject tokens but different predicate tokens on each side — then invert
    // the vote. A "False" rating on "earth is flat" supports "earth is round", not contradicts.
    //
    // Negation flip: "not" is a stop word so meaningfulTokens strips it, making
    // "wall is visible" and "wall is NOT visible" token-identical. Check negation
    // presence separately so a "True" rating on "wall is NOT visible from space"
    // correctly contradicts the user's claim "wall is visible from space".
    const reviewedText = safeString(m?.claimReviewed || m?.claim);
    const reviewTokens = reviewedText ? new Set(meaningfulTokens(reviewedText)) : null;
    const hasSharedSubject =
      reviewTokens !== null && [...userMeaningfulTokens].some((t) => reviewTokens.has(t));
    const hasTokenDiff =
      reviewTokens !== null &&
      [...userMeaningfulTokens].some((t) => !reviewTokens.has(t)) &&
      [...reviewTokens].some((t) => !userMeaningfulTokens.has(t));
    const negationFlip =
      NEGATION_RE.test(claimText) !== (reviewedText ? NEGATION_RE.test(reviewedText) : false);
    const contrary = hasSharedSubject && (hasTokenDiff || negationFlip);

    if (countPhraseHits(ratingText, CONTRADICTION_PHRASES) > 0) {
      contrary ? (supportScore += weight) : (contradictionScore += weight);
    } else if (countPhraseHits(ratingText, SUPPORT_PHRASES) > 0) {
      contrary ? (contradictionScore += weight) : (supportScore += weight);
    }
  }

  // A score of ≥ 2 means either one authoritative source or two coverage sources agree.
  if (contradictionScore > supportScore && contradictionScore >= 2) return "contradicted";
  if (supportScore > contradictionScore && supportScore >= 2) return "supported";

  // Both sides have at least one vote: genuine conflict. Do not let Phase 2
  // text-scan silently pick a winner based on sort order — return unclear so
  // the UI shows "Unconfirmed" instead of a false-confidence definitive verdict.
  if (contradictionScore > 0 && supportScore > 0) return "unclear";

  // ---------------------------------------------------------------------------
  // Phase 2: fallback to the top-match combined-text scan for single matches
  // and zero-vote evidence. The top rating is sourced from matchText
  // (candidateText) only — the previous duplicate of result.top.rating.text
  // is removed.
  // ---------------------------------------------------------------------------
  const combined = [safeString(matchText), safeString(result?.message)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const contradictionHits = countPhraseHits(combined, CONTRADICTION_PHRASES);
  const supportHits = countPhraseHits(combined, SUPPORT_PHRASES);

  if (contradictionHits > supportHits && contradictionHits >= 1) return "contradicted";
  if (supportHits > contradictionHits && supportHits >= 1) return "supported";

  const claimNums = extractNumbers(claimText);
  const matchNums = extractNumbers(matchText);
  const claimEnts = extractNamedEntitiesHeuristic(claimText);
  const matchEnts = extractNamedEntitiesHeuristic(matchText);

  if (setOverlapCount(claimNums, matchNums) >= 1 || setOverlapCount(claimEnts, matchEnts) >= 1) {
    return "unclear";
  }

  return "unclear";
}

/**
 * Derives a ReasonCode from an already-computed stance + the raw provider result.
 * Does not change stance — purely diagnostic annotation.
 *
 * Calling convention: pass the result object as it arrives from the provider
 * (before enrichment), plus the RelevanceAssessment and Stance already computed.
 */
export function deriveReasonCode(
  stance: Stance,
  status: string,
  result: any,
  assessment?: RelevanceAssessment,
): ReasonCode {
  if (status === "error") return "provider_error";
  if (status === "no_match") return "no_reliable_match";

  // Source found but doesn't align with the claim.
  if (assessment?.relevant === false) return "source_not_relevant";

  if (stance === "contradicted") {
    const provider =
      safeString(result?.top?.provider) ||
      safeString(result?.matches?.[0]?.provider);
    return provider === "google_factcheck" || provider === "known_fact_override"
      ? "authoritative_contradiction"
      : "coverage_contradiction";
  }

  if (stance === "supported") {
    const provider =
      safeString(result?.top?.provider) ||
      safeString(result?.matches?.[0]?.provider);
    return provider === "google_factcheck" || provider === "known_fact_override"
      ? "authoritative_support"
      : "coverage_support";
  }

  // stance === "unclear" — diagnose why using the same phrase arrays as classifyClaimStance.
  const matches: any[] = Array.isArray(result?.matches) ? result.matches : [];
  let hasContradictionSignal = false;
  let hasSupportSignal = false;

  for (const m of matches) {
    const ratingText = safeString(m?.rating?.text).toLowerCase();
    if (!ratingText) continue;
    if (countPhraseHits(ratingText, CONTRADICTION_PHRASES) > 0) hasContradictionSignal = true;
    if (countPhraseHits(ratingText, SUPPORT_PHRASES) > 0) hasSupportSignal = true;
  }

  if (hasContradictionSignal && hasSupportSignal) return "mixed_evidence";
  if (hasContradictionSignal || hasSupportSignal) return "insufficient_evidence";

  // Matched status but no rating signals at all — source present but no verdict.
  return "insufficient_evidence";
}

/**
 * Computes a conservative confidence score (0–100) and tier for a verification
 * outcome. Scoring is additive from zero and fails low — no signal means no
 * confidence. The unclear-stance cap (≤35) prevents an authoritative-but-
 * ambiguous result from masquerading as medium confidence.
 *
 * Score components:
 *   Provider base  — known_fact_override +40, google_factcheck +35, news +15
 *   Stance clarity — clear + authoritative +25, clear + coverage +15
 *   Relevance      — relevant +15, not relevant −30
 *   Rating text    — top match has rating.text +5
 *   Match count    — 2–3 matches +5, 4+ matches +10
 *   Mixed evidence — both contradiction and support signals −15
 *   Caps           — unclear stance ≤35, no_match/error hard 0
 */
export function computeConfidence(
  stance: Stance,
  status: string,
  result: any,
  assessment?: RelevanceAssessment,
): { confidenceScore: number; confidenceTier: ConfidenceTier } {
  if (status === "error" || status === "no_match") {
    return { confidenceScore: 0, confidenceTier: "none" };
  }

  const matches: any[] = Array.isArray(result?.matches) ? result.matches : [];
  const topMatch = result?.top || matches[0];
  const topProvider = safeString(topMatch?.provider) || safeString(matches[0]?.provider);

  let score = 0;

  // Provider base
  if (topProvider === "known_fact_override") score += 40;
  else if (topProvider === "google_factcheck")  score += 35;
  else if (topProvider === "bing_news" || topProvider === "newsapi") score += 15;
  else if (topProvider) score += 5;

  // Stance clarity
  const isAuthoritative =
    topProvider === "google_factcheck" || topProvider === "known_fact_override";
  if (stance === "contradicted" || stance === "supported") {
    score += isAuthoritative ? 25 : 8;
  }

  // Relevance
  if (assessment?.relevant === true)  score += 15;
  if (assessment?.relevant === false) score -= 30;

  // Rating text presence on top match
  if (safeString(topMatch?.rating?.text)) score += 5;

  // Independent source count — use clustered representative count so that
  // five articles from the same outlet don't inflate the bonus.
  const { representativeCount } = clusterEvidence(matches);
  if (representativeCount >= 4)      score += 10;
  else if (representativeCount >= 2) score += 5;

  // Mixed evidence penalty
  let hasContradictionSignal = false;
  let hasSupportSignal = false;
  for (const m of matches) {
    const ratingText = safeString(m?.rating?.text).toLowerCase();
    if (!ratingText) continue;
    if (countPhraseHits(ratingText, CONTRADICTION_PHRASES) > 0) hasContradictionSignal = true;
    if (countPhraseHits(ratingText, SUPPORT_PHRASES) > 0)       hasSupportSignal = true;
  }
  if (hasContradictionSignal && hasSupportSignal) score -= 15;

  // Unclear stance cap — cannot reach medium without a clear direction
  if (stance === "unclear") score = Math.min(score, 35);

  score = Math.max(0, Math.min(100, score));

  const confidenceTier: ConfidenceTier =
    score >= 70 ? "high"   :
    score >= 40 ? "medium" :
    score >= 10 ? "low"    :
    "none";

  return { confidenceScore: score, confidenceTier };
}

/**
 * Counts supporting, contradicting, and neutral sources from raw matches[].
 * Uses the same phrase arrays as classifyClaimStance so counts stay consistent
 * with the upstream stance derivation — no new NLP work added here.
 */
export function summarizeEvidence(matches: any[]): {
  supporting: number;
  contradicting: number;
  neutral: number;
} {
  let supporting = 0;
  let contradicting = 0;
  let neutral = 0;
  for (const m of Array.isArray(matches) ? matches : []) {
    const r = safeString(m?.rating?.text).toLowerCase();
    if (!r) { neutral++; continue; }
    if (countPhraseHits(r, CONTRADICTION_PHRASES) > 0) contradicting++;
    else if (countPhraseHits(r, SUPPORT_PHRASES) > 0) supporting++;
    else neutral++;
  }
  return { supporting, contradicting, neutral };
}

// Short count-based sentence attached to every VerificationResult at build time.
// Distinct from getResultExplanation (UI layer) which uses stance/reasonCode/tier.
function buildExplanation(supporting: number, contradicting: number): string {
  const rated = supporting + contradicting;
  if (rated === 0) return "No verdict signals found in available sources.";
  if (supporting > 0 && contradicting > 0) {
    return `${supporting} source${supporting !== 1 ? "s" : ""} support and ${contradicting} contradict — verdict unclear.`;
  }
  if (contradicting > 0) {
    return `${contradicting} source${contradicting !== 1 ? "s" : ""} contradict this claim.`;
  }
  return `${supporting} source${supporting !== 1 ? "s" : ""} support this claim.`;
}

/**
 * Generates a short claim-aware summary from all matches.
 * Uses summarizeEvidence counts — no titles, no headlines, no external calls.
 *
 *   No matches                        → "No reliable evidence found."
 *   contradicting > supporting        → "Current reporting does not support this claim."
 *   supporting > contradicting        → "Available sources support this claim."
 *   both present (tied or mixed)      → "Sources show mixed or unclear information."
 *   only generic coverage (no ratings)→ "Recent coverage does not confirm this claim."
 */
export function buildSummary(matches: any[]): string {
  const all = Array.isArray(matches) ? matches : [];
  if (all.length === 0) return "No reliable evidence found.";

  const { supporting, contradicting } = summarizeEvidence(all);

  if (supporting === 0 && contradicting === 0) {
    return "Recent coverage does not confirm this claim.";
  }

  if (supporting > 0 && contradicting > 0) {
    return "Sources show mixed or unclear information.";
  }

  if (contradicting > supporting) {
    return "Current reporting does not support this claim.";
  }

  return "Available sources support this claim.";
}

export function buildOverrideVerification(
  override: ReturnType<typeof findKnownFactOverride>
) {
  if (!override) return null;

  const overrideStance = override.contradictsClaim
    ? ("contradicted" as const)
    : ("supported" as const);

  const overrideMatchShape = {
    matches: [{ provider: "known_fact_override", rating: { text: override.contradictsClaim ? "Contradicted" : "Supported" } }],
  };
  const { confidenceScore, confidenceTier } = computeConfidence(
    overrideStance, "matched", overrideMatchShape, { relevant: true, reason: "Known fact override." }
  );
  const explanation = override.contradictsClaim
    ? "Known fact override: this claim is contradicted."
    : "Known fact override: this claim is supported.";
  const summary = override.contradictsClaim
    ? "Sources confirm this claim is contradicted by a known fact."
    : "Sources confirm this claim is supported by a known fact.";

  return {
    status: "matched" as const,
    mode: "fact_check" as const,
    stance: overrideStance,
    reasonCode: override.contradictsClaim
      ? ("authoritative_contradiction" as const)
      : ("authoritative_support" as const),
    confidenceScore,
    confidenceTier,
    explanation,
    summary,
    relevance: {
      relevant: true,
      reason: "Known fact override matched this claim family.",
    },
    matches: [
      {
        provider: "known_fact_override",
        claim: override.reason,
        url: override.sourceUrl || "",
        publisher: override.sourceLabel || "Known facts",
        title: override.label || "Known fact override",
        rating: {
          text: override.contradictsClaim ? "Contradicted" : "Supported",
          raw: override.contradictsClaim ? "Contradicted" : "Supported",
        },
        snippet: override.reason,
      },
    ],
    top: {
      provider: "known_fact_override",
      claim: override.reason,
      url: override.sourceUrl || "",
      publisher: override.sourceLabel || "Known facts",
      title: override.label || "Known fact override",
      rating: {
        text: override.contradictsClaim ? "Contradicted" : "Supported",
        raw: override.contradictsClaim ? "Contradicted" : "Supported",
      },
      snippet: override.reason,
    },
    message: override.reason,
  };
}

// result/return typed as any: EngineVerificationCompat lives in the hook and
// cannot be imported here without a circular dependency. The type annotation at
// the call site in the hook still enforces the shape.
export function buildVerificationFromResult(
  result: any,
  assessment: RelevanceAssessment,
  stance: Stance,
  mode: "fact_check" | "recent_coverage" | undefined,
  claimText?: string,
): any {
  const bestTop = pickTopMatch(result?.matches, claimText) ?? result?.top;
  const topOverride = bestTop !== undefined ? { top: bestTop } : {};

  const _rawMatches: any[] = Array.isArray(result?.matches) ? result.matches : [];
  const _ev = summarizeEvidence(_rawMatches);
  const explanation = buildExplanation(_ev.supporting, _ev.contradicting);
  const summary = buildSummary(_rawMatches);

  if (result?.status === "matched" && !assessment.relevant) {
    const { confidenceScore, confidenceTier } = computeConfidence("unclear", "matched", result, assessment);
    return {
      ...result,
      ...topOverride,
      stance: "unclear",
      reasonCode: deriveReasonCode("unclear", "matched", result, assessment),
      confidenceScore,
      confidenceTier,
      explanation,
      summary,
      relevance: assessment,
      message: mergeVerificationMessage(
        result,
        "A source was found, but it doesn't closely match this claim."
      ),
    };
  }

  if (result?.status === "matched" && assessment.relevant) {
    if (stance === "contradicted") {
      const { confidenceScore, confidenceTier } = computeConfidence(stance, "matched", result, assessment);
      return {
        ...result,
        ...topOverride,
        stance,
        reasonCode: deriveReasonCode(stance, "matched", result, assessment),
        confidenceScore,
        confidenceTier,
        explanation,
        summary,
        relevance: assessment,
        message: mergeVerificationMessage(
          result,
          mode === "fact_check"
            ? "Relevant source found, and it appears to contradict the claim."
            : "Relevant coverage found, but it appears to contradict the claim."
        ),
      };
    }

    if (stance === "supported") {
      const { confidenceScore, confidenceTier } = computeConfidence(stance, "matched", result, assessment);
      return {
        ...result,
        ...topOverride,
        stance,
        reasonCode: deriveReasonCode(stance, "matched", result, assessment),
        confidenceScore,
        confidenceTier,
        explanation,
        summary,
        relevance: assessment,
        message: mergeVerificationMessage(
          result,
          mode === "fact_check"
            ? "Relevant source found, and it appears to support the claim."
            : "Relevant current coverage found for this claim."
        ),
      };
    }

    const { confidenceScore, confidenceTier } = computeConfidence(stance, "matched", result, assessment);
    return {
      ...result,
      ...topOverride,
      stance,
      reasonCode: deriveReasonCode(stance, "matched", result, assessment),
      confidenceScore,
      confidenceTier,
      explanation,
      summary,
      relevance: assessment,
      message: mergeVerificationMessage(
        result,
        mode === "fact_check"
          ? "Relevant source found, but support versus contradiction is still unclear."
          : "Relevant current coverage found, but the final stance is still unclear."
      ),
    };
  }

  if (result?.status === "no_match") {
    return {
      ...result,
      stance: "unclear",
      reasonCode: "no_reliable_match" as const,
      confidenceScore: 0,
      confidenceTier: "none" as const,
      explanation: "No matching source found.",
      summary: "No reliable evidence found.",
      relevance: {
        relevant: false,
        reason: "No direct matching source was returned.",
      },
      message:
        safeString(result?.message) ||
        "No relevant fact check or recent coverage found.",
    };
  }

  return {
    ...result,
    status: "error",
    stance: "unclear",
    reasonCode: "provider_error" as const,
    confidenceScore: 0,
    confidenceTier: "none" as const,
    explanation: "Verification could not complete.",
    summary: "Verification could not complete.",
    relevance: {
      relevant: false,
      reason: "Verification provider failed before a usable result was returned.",
    },
    message: safeString(result?.message) || "Verification provider failed.",
  };
}

// Builds a verification object for the catch path (network/parse exception),
// where no provider result object exists. Keeps exception errors on the same
// shape as the result-based error path from buildVerificationFromResult.
export function buildExceptionVerification(error: any): {
  status: "error";
  matches: never[];
  stance: "unclear";
  reasonCode: "provider_error";
  confidenceScore: 0;
  confidenceTier: "none";
  explanation: string;
  summary: string;
  relevance: { relevant: false; reason: string };
  message: string;
} {
  const message =
    safeString(error?.message) ||
    String(error || "") ||
    "Unknown verification error.";
  return {
    status: "error",
    matches: [],
    stance: "unclear",
    reasonCode: "provider_error",
    confidenceScore: 0,
    confidenceTier: "none",
    explanation: "Verification could not complete.",
    summary: "Verification could not complete.",
    relevance: {
      relevant: false,
      reason: "Verification request threw an exception.",
    },
    message,
  };
}

// Returns a label for when ClashBot last ran verification on a claim.
// Uses the epoch timestamp stored as capturedAt / completedAt.
// Distinct from formatEvidenceDate, which labels the source article's own date.
export function formatVerificationAge(completedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - completedAt) / 1000));
  if (seconds < 60) return "Verified just now";
  if (seconds < 3600) return `Verified ${Math.floor(seconds / 60)}m ago`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `Verified ${hours}h ago`;
  return `Verified ${Math.floor(hours / 24)}d ago`;
}

// Returns a human-readable freshness label for a provider date string.
//
// Fact-check mode:   "Reviewed Jan 2023"  (the claim may be old; show review date)
// Coverage mode:     relative time — "Today", "3 days ago", "2 months ago", etc.
// No date / invalid: undefined (caller renders nothing)
export function formatEvidenceDate(
  claimDate: string | undefined,
  mode: "fact_check" | "recent_coverage" | undefined
): string | undefined {
  if (!claimDate) return undefined;
  const ms = Date.parse(claimDate);
  if (!Number.isFinite(ms)) return undefined;

  if (mode === "fact_check") {
    const d = new Date(ms);
    const month = d.toLocaleString("en-US", { month: "short" });
    return `Reviewed ${month} ${d.getFullYear()}`;
  }

  const ageDays = Math.floor((Date.now() - ms) / 86_400_000);
  if (ageDays < 0) return undefined;
  if (ageDays === 0) return "Today";
  if (ageDays === 1) return "Yesterday";
  if (ageDays <= 6) return `${ageDays} days ago`;
  if (ageDays <= 13) return "Last week";
  const weeks = Math.floor(ageDays / 7);
  if (weeks <= 4) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(ageDays / 30);
  if (months <= 11) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(ageDays / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

// Convenience wrapper: builds evidence directly from a raw provider result object,
// without requiring the caller to unpack result.matches / result.mode.
// This is the preferred call site for the engine; buildEvidenceFromMatches
// remains exported for callers that already have a bare matches array.
export function buildEvidenceFromResult(
  result: any,
  stance: Stance,
  capturedAt: number,
  claimText?: string,
): EvidenceRecord[] {
  return buildEvidenceFromMatches(result?.matches, result?.mode, stance, capturedAt, claimText);
}

// matches typed as any[] because the engine's runtime objects have all fields
// optional, while the strict FactCheckMatch from lib/clashbot/types.ts requires
// provider/claim/url. All access is already guarded via safeString/optional
// chaining so runtime behavior is unchanged.
export function buildEvidenceFromMatches(
  matches: FactCheckMatch[] | any[] | undefined,
  mode: "fact_check" | "recent_coverage" | undefined,
  stance: Stance,
  capturedAt: number,
  claimText?: string,
): EvidenceRecord[] {
  const list = Array.isArray(matches) ? matches : [];
  const scoreFn = claimText
    ? (m: any) => scoreMatchForClaim(claimText, m)
    : matchQualityScore;
  const sorted = [...list].sort((a, b) => scoreFn(b) - scoreFn(a));

  return sorted.map((m: any, index: number) => {
    const provider = safeString(m?.provider) || "unknown";
    const url = safeString(m?.url) || undefined;
    const publisher = safeString(m?.publisher) || (url ? domainFromUrl(url) : undefined) || undefined;

    return {
      id: makeId("evidence", `${provider}_${m?.url || m?.title || m?.claim || index}_${capturedAt}`),
      provider,
      kind: normalizeEvidenceKind(provider, mode),
      url,
      publisher,
      title: safeString(m?.title) || undefined,
      claim: safeString(m?.claim) || undefined,
      claimReviewed: safeString(m?.claimReviewed) || undefined,
      claimDate: safeString(m?.claimDate) || undefined,
      snippet: safeString(m?.snippet) || undefined,
      ratingText: safeString(m?.rating?.text) || undefined,
      ratingRaw: safeString(m?.rating?.raw) || undefined,
      capturedAt,
      supports: stance === "supported",
      contradicts: stance === "contradicted",
      stance,
    };
  });
}
