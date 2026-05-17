// lib/clashbot/resultExplanation.ts
//
// Pure helper: maps verification signals → one short human-readable sentence.
//
// Inputs are all existing pipeline outputs (stance, reasonCode, confidenceTier,
// representativeCount). No verification logic is changed here.
//
// Returns null for transient states (queued, checking) and for any combination
// that does not map to a useful sentence — callers should fall back gracefully.

import type { ConfidenceTier, ReasonCode, Stance } from "@/lib/claim/types";

export type ExplanationInput = {
  status?: string;
  stance?: Stance;
  reasonCode?: ReasonCode;
  confidenceTier?: ConfidenceTier;
  /** Clustered (deduplicated) match count. Use representativeCount, not raw match count. */
  representativeCount?: number;
  /**
   * Provider mode from the router. Accepts both raw ("fact_check", "recent_coverage")
   * and normalised ("factcheck", "news") forms so callers don't need to convert.
   */
  mode?: string;
};

// ---------------------------------------------------------------------------
// Result meta — surface-agnostic trust/context labels
// ---------------------------------------------------------------------------

/**
 * High-level result category, distinct from the internal `mode` field.
 *   "fact_check"        — a formal fact-check database review was matched.
 *   "breaking_coverage" — live/recent news coverage matched the claim.
 *   "mixed"             — unclear, developing, or insufficient evidence.
 */
export type ResultType = "breaking_coverage" | "fact_check" | "mixed";

/**
 * Human-readable confidence label derived from `confidenceTier`.
 * Suitable for display on any surface (text, voice, cross-app).
 */
export type ConfidenceLabel = "High confidence" | "Moderate confidence" | "Developing";

export type ResultMeta = {
  resultType: ResultType;
  confidenceLabel: ConfidenceLabel;
  /**
   * One short sentence explaining why this result was selected — based entirely
   * on existing pipeline signals. Surfaces the key trust factor in plain language.
   *
   * Examples:
   *   "A formal fact-check result with a clear verdict matched this claim."
   *   "Recent coverage from multiple sources matched the claim."
   *   "Coverage exists, but reporting is still developing."
   */
  shortWhyItWon: string;
};

/**
 * Derives the three surface-agnostic trust/context labels from existing
 * verification signals. Pure function — no network calls, no state.
 *
 * Intended to be called after buildVerificationFromResult and attached to the
 * output object so every consumer (text UI, voice, cross-app) gets the same
 * pre-computed labels without duplicating logic.
 */
export function getResultMeta(input: ExplanationInput): ResultMeta {
  const {
    status,
    stance,
    reasonCode,
    confidenceTier,
    representativeCount = 0,
    mode,
  } = input;

  // ---- confidenceLabel -------------------------------------------------------
  const confidenceLabel: ConfidenceLabel =
    confidenceTier === "high"   ? "High confidence"     :
    confidenceTier === "medium" ? "Moderate confidence" :
    "Developing";

  // ---- resultType ------------------------------------------------------------
  // Fact-check: authoritative source (Google FC / known fact) or fact-check mode.
  const isFactCheck =
    mode === "fact_check" || mode === "factcheck" ||
    reasonCode === "authoritative_contradiction" ||
    reasonCode === "authoritative_support";

  // Breaking coverage: news/search provider or coverage-type reason code.
  const isCoverage =
    !isFactCheck && (
      mode === "recent_coverage" || mode === "news" ||
      reasonCode === "coverage_support" ||
      reasonCode === "coverage_contradiction"
    );

  const resultType: ResultType =
    isFactCheck ? "fact_check" :
    isCoverage  ? "breaking_coverage" :
    "mixed";

  // ---- shortWhyItWon ---------------------------------------------------------
  let shortWhyItWon: string;

  if (status === "error" || reasonCode === "provider_error") {
    shortWhyItWon = "Verification could not complete.";
  } else if (status === "no_match" || reasonCode === "no_reliable_match") {
    shortWhyItWon = "No reliable source matched this claim.";
  } else if (reasonCode === "source_not_relevant") {
    shortWhyItWon = "A source was found, but it doesn't closely match this claim.";
  } else if (reasonCode === "mixed_evidence") {
    shortWhyItWon = "Sources disagree — reporting is ongoing.";
  } else if (reasonCode === "insufficient_evidence") {
    shortWhyItWon = "Coverage exists, but reporting is still developing.";
  } else if (resultType === "fact_check") {
    if (stance === "contradicted" || stance === "supported") {
      shortWhyItWon = confidenceTier === "high"
        ? "A formal fact-check result with a clear verdict matched this claim."
        : "A fact-check source reviewed this claim.";
    } else {
      shortWhyItWon = "Fact-checkers found this claim, but the verdict is unclear.";
    }
  } else if (resultType === "breaking_coverage") {
    if (representativeCount >= 2) {
      shortWhyItWon = "Recent coverage from multiple sources matched the claim.";
    } else if (stance === "supported" || stance === "contradicted") {
      shortWhyItWon = "A recent source with a clear position covered this claim.";
    } else {
      shortWhyItWon = "Coverage exists, but reporting is still developing.";
    }
  } else {
    shortWhyItWon = "Coverage exists, but reporting is still developing.";
  }

  return { resultType, confidenceLabel, shortWhyItWon };
}

/**
 * Returns a single short sentence explaining the verification result, or null
 * for states that have no useful explanation yet (transient / unknown).
 *
 * Decision order:
 *   1. Transient → null (checking / queued)
 *   2. Infrastructure failure
 *   3. No match
 *   4. Source found but irrelevant
 *   5. Conflicting or insufficient signals
 *   6. Clear verdict: contradicted (authoritative → coverage)
 *   7. Clear verdict: supported (authoritative → coverage)
 *   8. Fallback → null
 */
export function getResultExplanation(input: ExplanationInput): string | null {
  const {
    status,
    stance,
    reasonCode,
    confidenceTier,
    representativeCount = 0,
  } = input;

  // 1. Transient — no result yet
  if (!status || status === "queued" || status === "checking") return null;

  // 2. Infrastructure failure
  if (status === "error" || reasonCode === "provider_error") {
    return "Verification could not complete.";
  }

  // 3. No matching source
  if (status === "no_match" || reasonCode === "no_reliable_match") {
    return "No reliable matching source was found.";
  }

  // 4. Source found but doesn't align with the claim
  if (reasonCode === "source_not_relevant") {
    return "A source was found but doesn't closely match this claim.";
  }

  // 5a. Conflicting signals — genuine disagreement across sources
  if (reasonCode === "mixed_evidence") {
    return "Relevant sources disagree, so the verdict remains unclear.";
  }

  // 5b. Weak signals — source present but below the confidence threshold
  if (reasonCode === "insufficient_evidence") {
    return "Sources were found, but the signals are too weak to confirm a verdict.";
  }

  // 6. Clear contradiction
  if (stance === "contradicted") {
    if (reasonCode === "authoritative_contradiction") {
      return confidenceTier === "high"
        ? "High-confidence contradiction from an authoritative fact-check."
        : "A fact-check source contradicts this claim.";
    }
    if (reasonCode === "coverage_contradiction") {
      return representativeCount >= 2
        ? "Multiple independent sources contradict this claim."
        : "A news source contradicts this claim, though evidence is not authoritative.";
    }
    return "This claim appears to be contradicted by available sources.";
  }

  // 7. Clear support
  if (stance === "supported") {
    if (reasonCode === "authoritative_support") {
      return confidenceTier === "high"
        ? "High-confidence support from an authoritative fact-check."
        : "A fact-check source supports this claim.";
    }
    if (reasonCode === "coverage_support") {
      return representativeCount >= 2
        ? "Several relevant sources support this claim."
        : "A news source supports this claim, though evidence is not authoritative.";
    }
    return "This claim appears to be supported by available sources.";
  }

  // 8. No useful sentence available
  return null;
}
