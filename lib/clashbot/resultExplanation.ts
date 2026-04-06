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
};

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
