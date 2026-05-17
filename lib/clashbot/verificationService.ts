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

import type {
  ClaimType,
  ConfidenceTier,
  ConsensusStrength,
  DisplayVerdict,
  EvidenceDirectness,
  EvidenceRecord,
  EvidenceStance,
  Freshness,
  ReasonCode,
  RelevanceAssessment,
  SourceDiversity,
  Stance,
  VerdictKind,
  VerdictTone,
  VerdictTrace,
} from "../claim/types";
import { clusterEvidence } from "./evidenceClustering";
import { findKnownFactOverride } from "./knownFacts";
import { getResultMeta } from "./resultExplanation";
import type { FactCheckMatch } from "./types";

export type { ClaimType, ConfidenceTier, DisplayVerdict, EvidenceRecord, ReasonCode, RelevanceAssessment, Stance, VerdictTrace };

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

// ---------------------------------------------------------------------------
// Source quality tiers — used by matchQualityScore to prefer reputable outlets
// over low-quality blogs when all other signals are equal.
// Matched against the URL hostname (www. stripped).
// ---------------------------------------------------------------------------

const SOURCE_TIER_1 = new Set([
  // Wire services / financial press: fastest on breaking events, minimal editorial lag
  "reuters.com", "apnews.com", "bloomberg.com", "ft.com", "wsj.com",
]);

const SOURCE_TIER_2 = new Set([
  // Major broadcast / print
  "bbc.com", "bbc.co.uk", "cnn.com", "nytimes.com",
  "washingtonpost.com", "theguardian.com", "npr.org",
  "economist.com", "time.com", "newsweek.com", "cbsnews.com",
  "abc.net.au",
]);

const SOURCE_TIER_3 = new Set([
  // Credible digital-native / cable
  "politico.com", "axios.com", "thehill.com",
  "abcnews.go.com", "nbcnews.com", "foxnews.com",
  "usatoday.com", "pbs.org", "vox.com", "theatlantic.com",
  "msnbc.com", "independent.co.uk", "sky.com", "euronews.com",
]);

function sourceQualityBonus(m: any): number {
  const url = safeString(m?.url);
  let domain = "";
  try { domain = url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch {}
  if (SOURCE_TIER_1.has(domain)) return 15;
  if (SOURCE_TIER_2.has(domain)) return 10;
  if (SOURCE_TIER_3.has(domain)) return 5;
  return 0;
}

function matchQualityScore(m: any): number {
  const provider = safeString(m?.provider) || "unknown";
  let score = (3 - providerRank(provider)) * 20;
  if (safeString(m?.rating?.text)) score += 10;
  else if (provider === "bing_news" || provider === "newsapi") score -= 10; // coverage without verdict = weak signal
  if (safeString(m?.url)) score += 5;
  if (safeString(m?.publisher)) score += 3;
  if (safeString(m?.title)) score += 2;
  score += sourceQualityBonus(m);
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

  // SerpAPI organic position: Google's own relevance ranking is a meaningful
  // signal. Position 1 (top result) gets +10, decaying by 2 per position.
  // pos 1→+10, 2→+8, 3→+6, 4→+4, 5→+2, 6+→0
  const serpPos = typeof m?.serpApiPosition === "number" ? m.serpApiPosition : 0;
  if (serpPos > 0) {
    score += Math.max(0, 10 - (serpPos - 1) * 2);
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

// ---------------------------------------------------------------------------
// Claim anchor extraction and link-alignment scoring
// ---------------------------------------------------------------------------

// Event verbs used when extracting the "what" anchor from a claim. Broader
// than TEMPORAL_VERBS — includes speech acts ("said", "denied") so statement
// claims are covered alongside action claims.
const ANCHOR_VERB_RE =
  /\b(fired|dismissed|ousted|removed|replaced|resigned|quit|appointed|named|selected|arrested|detained|indicted|charged|sentenced|passed|signed|enacted|approved|rejected|vetoed|announced|declared|launched|released|banned|suspended|impeached|elected|died|killed|crashed|collapsed|said|claimed|stated|confirmed|denied|accused|warned)\b/gi;

// Time markers used for the "when" anchor.
const ANCHOR_TIME_RE =
  /\b(today|yesterday|just|now|recently|this week|this month|this year|last week|last month|breaking|latest)\b/gi;

// Synonym groups for common event verbs.
// When a claim uses a verb in a group, ALL synonyms are added to the "what"
// anchor so articles using equivalent language still produce a hit in
// scoreAlignment — no NLP, just a hardcoded equivalence map.
const VERB_SYNONYM_GROUPS: Readonly<Record<string, readonly string[]>> = {
  // removal / termination
  fired:       ["fired", "ousted", "dismissed", "removed", "replaced", "terminated", "forced out"],
  ousted:      ["fired", "ousted", "dismissed", "removed", "replaced", "terminated", "forced out"],
  dismissed:   ["fired", "ousted", "dismissed", "removed", "replaced", "terminated", "forced out"],
  removed:     ["fired", "ousted", "dismissed", "removed", "replaced", "terminated", "forced out"],
  replaced:    ["fired", "ousted", "dismissed", "removed", "replaced", "terminated", "forced out"],
  terminated:  ["fired", "ousted", "dismissed", "removed", "replaced", "terminated", "forced out"],
  // resignation / departure
  resigned:    ["resigned", "quit", "stepped down", "departed", "left"],
  quit:        ["resigned", "quit", "stepped down", "departed", "left"],
  // appointment / selection
  appointed:   ["appointed", "named", "selected", "tapped", "confirmed", "nominated", "chosen"],
  named:       ["appointed", "named", "selected", "tapped", "confirmed", "nominated", "chosen"],
  selected:    ["appointed", "named", "selected", "tapped", "confirmed", "nominated", "chosen"],
  // arrest / detention
  arrested:    ["arrested", "detained", "apprehended", "taken into custody", "held"],
  detained:    ["arrested", "detained", "apprehended", "taken into custody", "held"],
  // legal charges
  indicted:    ["indicted", "charged", "accused", "prosecuted"],
  charged:     ["indicted", "charged", "accused", "prosecuted"],
  // speech / statement
  said:        ["said", "stated", "announced", "declared", "claimed", "posted", "tweeted"],
  stated:      ["said", "stated", "announced", "declared", "claimed", "posted", "tweeted"],
  announced:   ["announced", "said", "declared", "revealed", "confirmed", "stated"],
  declared:    ["announced", "said", "declared", "revealed", "confirmed", "stated"],
  // prohibition / suspension
  banned:      ["banned", "suspended", "barred", "blocked", "prohibited"],
  suspended:   ["banned", "suspended", "barred", "blocked", "prohibited"],
  // legislation
  passed:      ["passed", "enacted", "signed", "approved", "adopted"],
  signed:      ["passed", "enacted", "signed", "approved", "adopted"],
  enacted:     ["passed", "enacted", "signed", "approved", "adopted"],
  approved:    ["passed", "enacted", "signed", "approved", "adopted"],
  // election / victory
  elected:     ["elected", "won", "voted in"],
  won:         ["elected", "won", "voted in"],
};

interface ClaimAnchors {
  /** Named entities: ALL-CAPS acronyms + multi-word title-case phrases. */
  who: string[];
  /**
   * Event verbs expanded to synonym groups + up to 3 significant topic nouns.
   * Synonym expansion means "fired" in the claim also matches "ousted" in an article.
   */
  what: string[];
  /** Explicit time words or recency markers. */
  when: string[];
}

/**
 * Extracts structured anchors from a claim string.
 * Returns three buckets (who/what/when) used by scoreAlignment to decide
 * how well a provider match covers the claim.
 *
 * The "what" bucket is synonym-expanded: every verb matched from the claim is
 * replaced by its full equivalence group so that articles using different but
 * semantically equivalent verbs still produce a hit.
 */
function extractClaimAnchors(text: string): ClaimAnchors {
  const who: string[] = [];
  for (const m of text.match(/\b[A-Z]{2,}\b/g) || []) who.push(m);
  for (const m of text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) || []) who.push(m);

  const what: string[] = [];
  // Collect raw verbs from the claim, then expand each to its synonym group.
  const expandedVerbs = new Set<string>();
  for (const m of text.match(ANCHOR_VERB_RE) || []) {
    const v = m.toLowerCase();
    const group = VERB_SYNONYM_GROUPS[v];
    if (group) {
      for (const syn of group) expandedVerbs.add(syn);
    } else {
      expandedVerbs.add(v);
    }
  }
  what.push(...expandedVerbs);

  // Significant topic nouns that aren't already covered by a named entity.
  const entityLower = new Set(who.map((e) => e.toLowerCase()));
  const topicNouns = meaningfulTokens(text)
    .filter((t) => t.length >= 4 && !Array.from(entityLower).some((e) => e.includes(t)));
  what.push(...topicNouns.slice(0, 3));

  const when: string[] = [];
  for (const m of text.match(ANCHOR_TIME_RE) || []) when.push(m.toLowerCase());

  return { who, what, when };
}

interface AlignmentResult {
  tier: "strong" | "weak" | "reject";
  matchWhy: string;
}

/**
 * Scores how tightly a single provider match aligns with the claim anchors.
 *
 *   strong — ≥2 anchor categories hit (who+what, who+when, etc.)
 *   weak   — exactly 1 anchor category hit
 *   reject — no anchor found in title/snippet
 *
 * Also produces a human-readable `matchWhy` string, e.g.:
 *   "Matched on Pam Bondi + firing"
 *   "Matched on Trump + statement + Easter"
 *   "Matched on gas prices + this month"
 */
function scoreAlignment(anchors: ClaimAnchors, match: any): AlignmentResult {
  const haystack = [
    safeString(match?.title),
    safeString(match?.snippet),
    safeString(match?.claim),
    safeString(match?.claimReviewed),
  ].join(" ").toLowerCase();

  // Each entity requires ALL its words to appear (handles multi-word names).
  const hitWho = anchors.who.filter((e) =>
    e.split(/\s+/).every((w) => haystack.includes(w.toLowerCase()))
  );
  const hitWhat = anchors.what.filter((v) => haystack.includes(v));
  const hitWhen = anchors.when.filter((t) => haystack.includes(t));

  const categoriesHit = [hitWho.length > 0, hitWhat.length > 0, hitWhen.length > 0]
    .filter(Boolean).length;

  // Build a readable explanation from the matched anchors (max 3 items).
  const parts = [
    ...hitWho.slice(0, 2),
    ...hitWhat.slice(0, 1),
    ...hitWhen.slice(0, 1),
  ].slice(0, 3);
  const matchWhy = parts.length > 0
    ? `Matched on ${parts.join(" + ")}`
    : "No strong anchor match";

  if (categoriesHit >= 2) return { tier: "strong", matchWhy };
  if (categoriesHit === 1) return { tier: "weak",   matchWhy };
  return { tier: "reject", matchWhy: "No strong anchor match" };
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
  //
  // Skip for news/recent_coverage results: article prose routinely contains
  // SUPPORT_PHRASES ("true", "correct") in neutral context ("it's true that
  // conspiracy theories persist") producing false verdicts.
  // ---------------------------------------------------------------------------
  if (result?.mode !== "recent_coverage") {
    const combined = [safeString(matchText), safeString(result?.message)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const contradictionHits = countPhraseHits(combined, CONTRADICTION_PHRASES);
    const supportHits = countPhraseHits(combined, SUPPORT_PHRASES);

    if (contradictionHits > supportHits && contradictionHits >= 1) return "contradicted";
    if (supportHits > contradictionHits && supportHits >= 1) return "supported";
  }

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
 *   No matches                          → "🤷 No evidence"
 *   supporting > contradicting          → "✅ Supported"
 *   contradicting > supporting          → "❌ Not supported"
 *   both present (mixed)                → "⚠️ Mixed signals"
 *   coverage exists but no verdict      → "👀 Rumor heat"
 *     (supporting === 0 && contradicting === 0, but matches exist)
 *     These are articles that discuss the claim without issuing a verdict —
 *     active coverage but no confirmation. Honest but engaging.
 *
 * Each verdict has its own fallback reason used when no usable snippet exists.
 * When a top match has a snippet or title, appends " — <cleaned reason>".
 */
export function buildSummary(matches: any[]): string {
  const all = Array.isArray(matches) ? matches : [];
  if (all.length === 0) return "🤷 No evidence";

  const { supporting, contradicting } = summarizeEvidence(all);

  let verdict: string;
  let fallbackReason: string;

  if (supporting === 0 && contradicting === 0) {
    // Coverage exists but no source issued a verdict — weak evidence / rumor state.
    verdict = "👀 Rumor heat";
    fallbackReason = "people are talking, but there's no solid confirmation yet";
  } else if (supporting > 0 && contradicting > 0) {
    verdict = "⚠️ Mixed signals";
    fallbackReason = "sources disagree on key details";
  } else if (contradicting > supporting) {
    verdict = "❌ Not supported";
    fallbackReason = "recent coverage contradicts this claim";
  } else {
    verdict = "✅ Supported";
    fallbackReason = "multiple sources confirm the claim";
  }

  // Append a cleaned context phrase from the top match (snippet preferred,
  // title as fallback). Falls back to the verdict-specific phrase if nothing usable.
  const top = all[0];
  const raw: string = safeString(top?.snippet) || safeString(top?.title);
  const reason = raw ? cleanSnippet(raw) : "";
  return `${verdict} — ${reason || fallbackReason}`;
}

/**
 * Cleans a raw snippet/title into a short, readable context phrase.
 *
 * Steps:
 *  1. Strip trailing ellipsis artifacts ("...", "…")
 *  2. Remove common filler phrases that add no context
 *  3. Trim to ~100 chars at a word boundary
 *  4. If the result is too short (<20 chars) return "" so the caller falls back
 */
function cleanSnippet(raw: string): string {
  const FILLERS = [
    /\baccording to( reports?| sources?| officials?)?\b[,:]?\s*/gi,
    /\bsources?\s+say\b[,:]?\s*/gi,
    /\bin an? (report|statement|interview|article|release)\b[,:]?\s*/gi,
    /\breport(s|ing|edly)?\b[,:]?\s*/gi,
    /\bit (has been|was) reported (that\s*)?/gi,
    /\bfollowing (reports?|claims?)\b[,:]?\s*/gi,
  ];

  let s = raw.trim();

  // 1. Strip trailing ellipsis artifacts
  s = s.replace(/\.{2,}$/, "").replace(/…$/, "").trimEnd();

  // 2. Remove filler phrases
  for (const pattern of FILLERS) {
    s = s.replace(pattern, "");
  }
  s = s.trim();

  // 3. Trim to ~100 chars at the last word boundary
  const limit = 100;
  if (s.length > limit) {
    s = s.slice(0, limit).replace(/\s+\S*$/, "").trimEnd() + "…";
  }

  // 4. Too short to be meaningful
  if (s.length < 20) return "";

  // Lowercase the first character so it reads as a continuation after " — "
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// VerdictTrace — internal reasoning and audit trail
// buildVerdictTrace: derives all fields from already-computed signals (no recomputation).
// buildDisplayVerdict: derives UI-safe strings from a VerdictTrace.
// Both are deterministic and contain no LLM calls.
// ---------------------------------------------------------------------------

function detectClaimType(claimText: string | undefined): ClaimType {
  if (!claimText) return "factual";
  const lower = claimText.toLowerCase();
  if (/\b(today|right now|just now|just happened|breaking|currently|at this moment)\b/.test(lower)) {
    return "real_time";
  }
  if (/\$\d+|\d+\s*%|\d[\d,]*\s*(million|billion|trillion)/i.test(lower)) {
    return "statistical";
  }
  return "factual";
}

function deriveEvidenceStance(stance: Stance, claimType: ClaimType, reasonCode: ReasonCode): EvidenceStance {
  if (claimType === "subjective") return "not_applicable";
  if (stance === "supported") return "evidence_supports";
  if (stance === "contradicted") return "evidence_contradicts";
  if (reasonCode === "mixed_evidence") return "evidence_mixed";
  return "evidence_absent";
}

function deriveVerdictKind(reasonCode: ReasonCode, claimType: ClaimType, overrideUsed: boolean): VerdictKind {
  if (overrideUsed) return "override_match";
  if (claimType === "subjective") return "subjective";
  if (
    claimType === "real_time" &&
    reasonCode !== "authoritative_contradiction" &&
    reasonCode !== "authoritative_support"
  ) {
    return "stale_data";
  }
  if (reasonCode === "authoritative_contradiction" || reasonCode === "authoritative_support") {
    return "authoritative_match";
  }
  if (reasonCode === "coverage_contradiction" || reasonCode === "coverage_support") {
    return "coverage_match";
  }
  if (reasonCode === "mixed_evidence") return "contested";
  if (reasonCode === "provider_error") return "error";
  return "unverifiable";
}

function deriveEvidenceDirectness(reasonCode: ReasonCode, sourceCount: number): EvidenceDirectness {
  if (sourceCount === 0) return "none";
  if (reasonCode === "authoritative_contradiction" || reasonCode === "authoritative_support") return "direct";
  if (
    reasonCode === "coverage_contradiction" ||
    reasonCode === "coverage_support" ||
    reasonCode === "mixed_evidence"
  ) {
    return "indirect";
  }
  return "none";
}

function deriveSourceDiversity(matches: any[], sourceCount: number): SourceDiversity {
  if (sourceCount === 0) return "none";
  if (sourceCount === 1) return "single_source";
  const providers = new Set(matches.map((m) => safeString(m?.provider)).filter(Boolean));
  if (providers.size >= 2) return "diverse";
  const domains = new Set<string>();
  for (const m of matches) {
    const url = safeString(m?.url);
    if (url) {
      try { domains.add(new URL(url).hostname.replace(/^www\./, "")); } catch {}
    }
  }
  if (domains.size >= 3) return "diverse";
  return "single_type";
}

function deriveConsensusStrength(ev: { supporting: number; contradicting: number }): ConsensusStrength {
  const total = ev.supporting + ev.contradicting;
  if (total === 0) return "absent";
  const majority = Math.max(ev.supporting, ev.contradicting);
  if (majority === total) return "unanimous";
  if (majority / total > 0.6) return "majority";
  return "split";
}

function deriveFreshness(claimType: ClaimType, matches: any[]): Freshness {
  if (claimType === "real_time") return "real_time_gap";
  if (matches.length === 0) return "unknown";
  const now = Date.now();
  const dates = matches
    .map((m) => safeString(m?.claimDate))
    .filter(Boolean)
    .map((d) => Date.parse(d))
    .filter(Number.isFinite);
  if (dates.length === 0) return "unknown";
  const ageDays = (now - Math.max(...dates)) / 86_400_000;
  return ageDays <= 180 ? "current" : "dated";
}

function buildVerdictReasons(
  verdictKind: VerdictKind,
  evidenceStance: EvidenceStance,
  confidence: ConfidenceTier,
  sourceCount: number,
  overrideUsed: boolean,
): string[] {
  const reasons: string[] = [];

  if (overrideUsed) {
    reasons.push("Authoritative knowledge base override applied");
  }

  switch (verdictKind) {
    case "override_match":
    case "authoritative_match":
      if (evidenceStance === "evidence_contradicts") {
        reasons.push(
          sourceCount > 1
            ? `${sourceCount} independent fact-checkers address this claim`
            : "Authoritative source contradicts this claim"
        );
      } else if (evidenceStance === "evidence_supports") {
        reasons.push(
          sourceCount > 1
            ? `${sourceCount} independent fact-checkers support this claim`
            : "Authoritative source supports this claim"
        );
      }
      break;
    case "coverage_match":
      if (evidenceStance === "evidence_contradicts") {
        reasons.push(`${sourceCount} coverage source${sourceCount !== 1 ? "s" : ""} contradict this claim`);
      } else if (evidenceStance === "evidence_supports") {
        reasons.push(`${sourceCount} coverage source${sourceCount !== 1 ? "s" : ""} reference this claim`);
      } else {
        reasons.push(`${sourceCount} source${sourceCount !== 1 ? "s" : ""} found — no clear verdict`);
      }
      break;
    case "contested":
      reasons.push(`Evidence conflicts — ${sourceCount} sources with divided verdicts`);
      break;
    case "subjective":
      reasons.push("Opinion-based claim — no objective standard exists");
      reasons.push("Not verifiable by fact-checking");
      break;
    case "unverifiable":
      reasons.push("No credible sources found for this claim");
      break;
    case "stale_data":
      reasons.push("Real-time claims cannot be reliably verified");
      if (sourceCount > 0) {
        reasons.push(
          `${sourceCount} coverage source${sourceCount !== 1 ? "s" : ""} found — no authoritative verdict available`
        );
      }
      break;
    case "error":
      reasons.push("Verification could not complete");
      break;
  }

  if (
    confidence === "low" &&
    verdictKind !== "stale_data" &&
    verdictKind !== "unverifiable" &&
    verdictKind !== "subjective"
  ) {
    reasons.push("Low confidence — limited or indirect coverage");
  }

  return reasons.slice(0, 3);
}

export function buildVerdictTrace(params: {
  stance: Stance;
  status: string;
  result: any;
  assessment: RelevanceAssessment;
  confidenceScore: number;
  confidence: ConfidenceTier;
  reasonCode: ReasonCode;
  claimType: ClaimType;
  overrideUsed: boolean;
}): VerdictTrace {
  const { stance, result, assessment, confidenceScore, confidence, reasonCode, claimType, overrideUsed } = params;
  const matches: any[] = Array.isArray(result?.matches) ? result.matches : [];
  const sourceCount = matches.length;

  const evidenceStance = deriveEvidenceStance(stance, claimType, reasonCode);
  const verdictKind = deriveVerdictKind(reasonCode, claimType, overrideUsed);
  const evidenceDirectness = deriveEvidenceDirectness(reasonCode, sourceCount);
  const sourceDiversity = deriveSourceDiversity(matches, sourceCount);
  const ev = summarizeEvidence(matches);
  const consensusStrength = deriveConsensusStrength(ev);
  const freshness = deriveFreshness(claimType, matches);
  const reasons = buildVerdictReasons(verdictKind, evidenceStance, confidence, sourceCount, overrideUsed);

  return {
    evidenceStance,
    claimType,
    verdictKind,
    reasonCode,
    evidenceDirectness,
    sourceDiversity,
    consensusStrength,
    freshness,
    sourceCount,
    overrideUsed,
    confidence,
    _confidenceScore: confidenceScore,
    reasons,
  };
}

export function buildDisplayVerdict(trace: VerdictTrace): DisplayVerdict {
  const { verdictKind, evidenceStance, sourceCount, confidence } = trace;

  let label: string;
  let sublabel: string;
  let tone: VerdictTone;
  let clashMechanic: DisplayVerdict["clashMechanic"];

  switch (verdictKind) {
    case "override_match":
    case "authoritative_match":
      if (evidenceStance === "evidence_contradicts") {
        label = "Evidence contradicts this claim";
        sublabel = sourceCount > 0
          ? `${sourceCount} fact-checker${sourceCount !== 1 ? "s" : ""} have reviewed this claim`
          : "Addressed by authoritative consensus";
        tone = "contradicted";
        clashMechanic = "factual_clash";
      } else {
        label = "Evidence supports this claim";
        sublabel = sourceCount > 0
          ? `${sourceCount} source${sourceCount !== 1 ? "s" : ""} confirm this claim`
          : "Supported by authoritative consensus";
        tone = "supported";
        clashMechanic = "none";
      }
      break;
    case "coverage_match":
      if (evidenceStance === "evidence_contradicts") {
        label = "Coverage disputes this";
        sublabel = `${sourceCount} source${sourceCount !== 1 ? "s" : ""} found — no authoritative verdict`;
        tone = "contradicted";
        clashMechanic = confidence === "high" || confidence === "medium" ? "factual_clash" : "none";
      } else {
        label = "Coverage references this";
        sublabel = `${sourceCount} source${sourceCount !== 1 ? "s" : ""} found — not a definitive verdict`;
        tone = "supported";
        clashMechanic = "none";
      }
      break;
    case "contested":
      label = "Experts genuinely disagree on this";
      sublabel = "Evidence found on both sides — this is actively contested";
      tone = "contested";
      clashMechanic = "none";
      break;
    case "subjective":
      label = "This is a matter of opinion";
      sublabel = "Both sides can make a case";
      tone = "subjective";
      clashMechanic = "subjective_clash";
      break;
    case "unverifiable":
      label = "No evidence found";
      sublabel = "This claim isn't addressed by available sources";
      tone = "unverifiable";
      clashMechanic = "none";
      break;
    case "stale_data":
      label = "Can't verify in real time";
      sublabel = sourceCount > 0
        ? "Recent coverage found — no authoritative verdict available yet"
        : "No sources found for this real-time claim";
      tone = "stale";
      clashMechanic = "none";
      break;
    case "error":
    default:
      label = "Verification unavailable";
      sublabel = "Check back later";
      tone = "unverifiable";
      clashMechanic = "none";
      break;
  }

  return { label, sublabel, tone, clashMechanic };
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
  const overrideReasonCode = override.contradictsClaim
    ? ("authoritative_contradiction" as const)
    : ("authoritative_support" as const);
  const explanation = override.contradictsClaim
    ? "Known fact override: this claim is contradicted."
    : "Known fact override: this claim is supported.";
  const summary = override.contradictsClaim
    ? "Sources confirm this claim is contradicted by a known fact."
    : "Sources confirm this claim is supported by a known fact.";
  const resultMeta = getResultMeta({
    status: "matched",
    stance: overrideStance,
    reasonCode: overrideReasonCode,
    confidenceTier,
    representativeCount: 1,
    mode: "fact_check",
  });

  const overrideTrace = buildVerdictTrace({
    stance: overrideStance,
    status: "matched",
    result: overrideMatchShape,
    assessment: { relevant: true, reason: "Known fact override." },
    confidenceScore,
    confidence: confidenceTier,
    reasonCode: overrideReasonCode,
    claimType: "factual",
    overrideUsed: true,
  });

  return {
    status: "matched" as const,
    mode: "fact_check" as const,
    stance: overrideStance,
    reasonCode: overrideReasonCode,
    confidenceScore,
    confidenceTier,
    explanation,
    summary,
    ...resultMeta,
    verdictTrace: overrideTrace,
    displayVerdict: buildDisplayVerdict(overrideTrace),
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
  const { representativeCount } = clusterEvidence(_rawMatches);
  const _claimType = detectClaimType(claimText);

  if (result?.status === "matched" && !assessment.relevant) {
    const { confidenceScore, confidenceTier } = computeConfidence("unclear", "matched", result, assessment);
    const reasonCode = deriveReasonCode("unclear", "matched", result, assessment);
    const resultMeta = getResultMeta({ status: "matched", stance: "unclear", reasonCode, confidenceTier, representativeCount, mode });
    const _trace = buildVerdictTrace({ stance: "unclear", status: "matched", result, assessment, confidenceScore, confidence: confidenceTier, reasonCode, claimType: _claimType, overrideUsed: false });
    return {
      ...result,
      ...topOverride,
      stance: "unclear",
      reasonCode,
      confidenceScore,
      confidenceTier,
      explanation,
      summary,
      relevance: assessment,
      ...resultMeta,
      verdictTrace: _trace,
      displayVerdict: buildDisplayVerdict(_trace),
      message: mergeVerificationMessage(
        result,
        "A source was found, but it doesn't closely match this claim."
      ),
    };
  }

  if (result?.status === "matched" && assessment.relevant) {
    if (stance === "contradicted") {
      const { confidenceScore, confidenceTier } = computeConfidence(stance, "matched", result, assessment);
      const reasonCode = deriveReasonCode(stance, "matched", result, assessment);
      const resultMeta = getResultMeta({ status: "matched", stance, reasonCode, confidenceTier, representativeCount, mode });
      const _trace = buildVerdictTrace({ stance, status: "matched", result, assessment, confidenceScore, confidence: confidenceTier, reasonCode, claimType: _claimType, overrideUsed: false });
      return {
        ...result,
        ...topOverride,
        stance,
        reasonCode,
        confidenceScore,
        confidenceTier,
        explanation,
        summary,
        relevance: assessment,
        ...resultMeta,
        verdictTrace: _trace,
        displayVerdict: buildDisplayVerdict(_trace),
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
      const reasonCode = deriveReasonCode(stance, "matched", result, assessment);
      const resultMeta = getResultMeta({ status: "matched", stance, reasonCode, confidenceTier, representativeCount, mode });
      const _trace = buildVerdictTrace({ stance, status: "matched", result, assessment, confidenceScore, confidence: confidenceTier, reasonCode, claimType: _claimType, overrideUsed: false });
      return {
        ...result,
        ...topOverride,
        stance,
        reasonCode,
        confidenceScore,
        confidenceTier,
        explanation,
        summary,
        relevance: assessment,
        ...resultMeta,
        verdictTrace: _trace,
        displayVerdict: buildDisplayVerdict(_trace),
        message: mergeVerificationMessage(
          result,
          mode === "fact_check"
            ? "Relevant source found, and it appears to support the claim."
            : "Relevant current coverage found for this claim."
        ),
      };
    }

    const { confidenceScore, confidenceTier } = computeConfidence(stance, "matched", result, assessment);
    const reasonCode = deriveReasonCode(stance, "matched", result, assessment);
    const resultMeta = getResultMeta({ status: "matched", stance, reasonCode, confidenceTier, representativeCount, mode });
    const _trace = buildVerdictTrace({ stance, status: "matched", result, assessment, confidenceScore, confidence: confidenceTier, reasonCode, claimType: _claimType, overrideUsed: false });
    return {
      ...result,
      ...topOverride,
      stance,
      reasonCode,
      confidenceTier,
      confidenceScore,
      explanation,
      summary,
      relevance: assessment,
      ...resultMeta,
      verdictTrace: _trace,
      displayVerdict: buildDisplayVerdict(_trace),
      message: mergeVerificationMessage(
        result,
        mode === "fact_check"
          ? "Relevant source found, but support versus contradiction is still unclear."
          : "Relevant current coverage found, but the final stance is still unclear."
      ),
    };
  }

  if (result?.status === "no_match") {
    const _noMatchAssessment = { relevant: false, reason: "No direct matching source was returned." };
    const _noMatchTrace = buildVerdictTrace({ stance: "unclear", status: "no_match", result, assessment: _noMatchAssessment, confidenceScore: 0, confidence: "none", reasonCode: "no_reliable_match", claimType: _claimType, overrideUsed: false });
    const resultMeta = getResultMeta({ status: "no_match", stance: "unclear", reasonCode: "no_reliable_match", confidenceTier: "none", representativeCount: 0, mode });
    return {
      ...result,
      stance: "unclear",
      reasonCode: "no_reliable_match" as const,
      confidenceScore: 0,
      confidenceTier: "none" as const,
      explanation: "No matching source found.",
      summary: "No reliable evidence found.",
      relevance: _noMatchAssessment,
      ...resultMeta,
      verdictTrace: _noMatchTrace,
      displayVerdict: buildDisplayVerdict(_noMatchTrace),
      message:
        safeString(result?.message) ||
        "No relevant fact check or recent coverage found.",
    };
  }

  const _errAssessment = { relevant: false, reason: "Verification provider failed before a usable result was returned." };
  const _errTrace = buildVerdictTrace({ stance: "unclear", status: "error", result, assessment: _errAssessment, confidenceScore: 0, confidence: "none", reasonCode: "provider_error", claimType: _claimType, overrideUsed: false });
  const resultMeta = getResultMeta({ status: "error", stance: "unclear", reasonCode: "provider_error", confidenceTier: "none", representativeCount: 0, mode });
  return {
    ...result,
    status: "error",
    stance: "unclear",
    reasonCode: "provider_error" as const,
    confidenceScore: 0,
    confidenceTier: "none" as const,
    explanation: "Verification could not complete.",
    summary: "Verification could not complete.",
    relevance: _errAssessment,
    ...resultMeta,
    verdictTrace: _errTrace,
    displayVerdict: buildDisplayVerdict(_errTrace),
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

  // Alignment filtering: when claimText is present, score each match against
  // the claim anchors. Drop "reject" tier matches only when at least one
  // non-reject match exists (fail-closed: never return an empty list).
  let candidates = sorted;
  if (claimText) {
    const anchors = extractClaimAnchors(claimText);
    const withAlignment = sorted.map((m) => ({
      m,
      alignment: scoreAlignment(anchors, m),
    }));
    const nonReject = withAlignment.filter((x) => x.alignment.tier !== "reject");
    if (nonReject.length > 0) {
      candidates = nonReject.map((x) => ({ ...x.m, _matchWhy: x.alignment.matchWhy }));
    } else {
      // All reject — keep everything but still stamp matchWhy on each item.
      candidates = withAlignment.map((x) => ({ ...x.m, _matchWhy: x.alignment.matchWhy }));
    }
  }

  return candidates.map((m: any, index: number) => {
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
      matchWhy: safeString(m?._matchWhy) || undefined,
    };
  });
}
