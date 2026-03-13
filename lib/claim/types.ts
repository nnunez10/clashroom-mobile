// lib/claim/types.ts
//
// Canonical domain types for the Claim subsystem.
// Phase 1: type definitions only — no logic, no imports from other lib files.
//
// Migration compatibility notes are marked with [COMPAT] and describe fields
// that exist only to match the current runtime shape. They will be cleaned up
// in the indicated future phase.

// ---------------------------------------------------------------------------
// Claim lifecycle
// ---------------------------------------------------------------------------

export type ClaimStatus =
  | "queued"
  | "checking"
  | "matched"
  | "no_match"
  | "disputed"
  | "error";

// [COMPAT] queuedAt mirrors extractClaims.ts `ts` field, renamed for clarity.
// checkingAt / completedAt exist on EngineClaim as top-level fields today;
// in Phase 6 these move exclusively into ClaimTimeline.
export interface ClaimTimeline {
  queuedAt: number;
  checkingAt?: number;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// Claim DNA (mirrors getClaimDna return from lib/clashbot/claimDna.ts)
// Do not duplicate this definition in other files.
// ---------------------------------------------------------------------------

export interface ClaimDna {
  normalized: string;
  tokens: string[];
  meaningfulTokens: string[];
  fingerprint: string;
  familyFingerprint: string;
  familyId: string;
  nodeId: string;
}

// ---------------------------------------------------------------------------
// Provider / verification primitives
// ---------------------------------------------------------------------------

export type Stance = "supported" | "contradicted" | "unclear";

/**
 * Machine-readable reason behind a verification outcome.
 * Annotates stance without changing it — existing supported/contradicted/unclear
 * behavior is preserved; reasonCode adds a layer of diagnostic precision.
 *
 * Authoritative = Google Fact Check or known-fact override (high-trust).
 * Coverage      = News/search coverage (signal, not a verdict).
 */
export type ReasonCode =
  | "authoritative_contradiction"  // High-trust source says the claim is false
  | "authoritative_support"        // High-trust source confirms the claim
  | "coverage_contradiction"       // Coverage source contradicts; lower certainty
  | "coverage_support"             // Coverage source supports; lower certainty
  | "mixed_evidence"               // Sources disagree — contradiction and support both present
  | "insufficient_evidence"        // Signals present but below the confidence threshold
  | "source_not_relevant"          // Source found but doesn't align with the claim
  | "no_reliable_match"            // No source found (no_match outcome)
  | "provider_error";              // Verification infrastructure failed

export interface RelevanceAssessment {
  relevant: boolean;
  reason: string;
}

// Canonical name for what lib/clashbot/types.ts calls FactCheckMatch.
// [COMPAT] Named ProviderMatch here; existing FactCheckMatch references in
// types.ts and useMockClashBotEngine.ts stay unchanged until Phase 3.
export interface ProviderMatch {
  url: string;
  publisher: string;
  title: string;
  snippet?: string;
  rating?: {
    text: string;
    raw: string;
  };
}

// ---------------------------------------------------------------------------
// VerificationOutcome
//
// This is the *enriched* orchestrated result owned by the claim domain.
// It is distinct from VerificationResult in lib/clashbot/types.ts, which is
// the raw provider response. VerificationResult stays where it is (Phase 3
// will create verificationService.ts to bridge the two).
// ---------------------------------------------------------------------------

export type VerificationOutcome =
  | {
      status: "matched";
      stance: Stance;
      reasonCode?: ReasonCode;
      mode: "factcheck" | "news" | "override";
      top: ProviderMatch;
      matches: ProviderMatch[];
      relevance?: RelevanceAssessment;
      message?: string;
    }
  | {
      status: "no_match";
      stance: Stance;
      reasonCode?: ReasonCode;
      mode: "factcheck" | "news" | "override";
      matches: ProviderMatch[];
      relevance?: RelevanceAssessment;
      message?: string;
    }
  | {
      status: "error";
      stance?: Stance;
      reasonCode?: ReasonCode;
      mode?: "factcheck" | "news" | "override";
      matches?: ProviderMatch[];
      message?: string;
    };

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

// [COMPAT] `supports` and `contradicts` boolean fields exist on the current
// EvidenceRecord in useMockClashBotEngine.ts and are read in ClashBotSheet.
// They will be replaced by a `stance` field (Stance type) in Phase 4 and
// removed here.
// url/title/publisher are optional here to match the engine's production path,
// which uses safeString(m?.url) || undefined and can yield undefined.
export interface EvidenceRecord {
  id: string;
  provider: string;
  kind: "fact_check" | "coverage" | "override" | "unknown";
  url?: string;
  publisher?: string;
  title?: string;
  claim?: string;
  claimReviewed?: string;
  claimDate?: string;
  snippet?: string;
  ratingText?: string;
  ratingRaw?: string;
  capturedAt: number;
  /** @deprecated Phase 4: replace with stance: Stance */
  supports?: boolean;
  /** @deprecated Phase 4: replace with stance: Stance */
  contradicts?: boolean;
  stance?: Stance;
}

// ---------------------------------------------------------------------------
// Claim events
// ---------------------------------------------------------------------------

export type ClaimEventType =
  | "queued"
  | "checking_started"
  | "matched"
  | "no_match"
  | "error"
  | "disputed"
  | "override_applied"
  | "family_linked";

export interface ClaimEvent {
  type: ClaimEventType;
  at: number;
  message?: string;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Core Claim domain object
// ---------------------------------------------------------------------------

// Canonical runtime Claim. This is what ClashBotSheet renders and what the
// engine produces. It supersedes the base Claim from extractClaims.ts and the
// EngineClaim from useMockClashBotEngine.ts — those stay in place until
// Phase 5/6 migration.
//
// [COMPAT] `ts` mirrors extractClaims.ts base Claim field (creation timestamp).
// Prefer timeline.queuedAt going forward; ts will be removed in Phase 6.
//
// [COMPAT] `checkingAt` and `completedAt` are top-level here to match
// EngineClaim's current shape. They will be removed from top-level and
// accessed exclusively via timeline in Phase 6.
//
// [COMPAT] `verification` will be renamed to `outcome: VerificationOutcome`
// once Phase 3 creates verificationService.ts and consumers are updated.
//
// [COMPAT] `claimDna` and `familyId` are optional here. Phase 5 makes them
// required after claimDetector.ts is extracted from extractClaims.ts.
export interface Claim {
  id: string;
  text: string;

  /** @deprecated Phase 6: use timeline.queuedAt */
  ts: number;

  status: ClaimStatus;

  /** @deprecated Phase 6: move exclusively into timeline */
  checkingAt?: number;
  /** @deprecated Phase 6: move exclusively into timeline */
  completedAt?: number;

  timeline?: ClaimTimeline;

  /** @deprecated Phase 3: rename to outcome: VerificationOutcome */
  verification?: VerificationOutcome;

  evidence?: EvidenceRecord[];
  events?: ClaimEvent[];

  /** @deprecated Phase 5: will become required */
  claimDna?: ClaimDna;

  /** @deprecated Phase 5: will become required (sourced from claimDna.familyId) */
  familyId?: string;

  /** ID of the earlier claim this was detected as a paraphrase of */
  derivedFromClaimId?: string;
}

// ---------------------------------------------------------------------------
// CandidateClaim
//
// Output of the detector layer (extractClaims.ts today, claimDetector.ts in
// Phase 5). Intentionally minimal — no verification, no evidence, no events.
// ---------------------------------------------------------------------------

export interface CandidateClaim {
  id: string;
  text: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// Claim family
// ---------------------------------------------------------------------------

export type ClaimFamilyStatus =
  | "pending"
  | "checking"
  | "settled_true"
  | "settled_false"
  | "settled_disputed"
  | "no_match";

export interface ClaimFamilyView {
  familyId: string;
  familyFingerprint: string;
  memberCount: number;
  status: ClaimFamilyStatus;
  representativeClaim?: Claim;
}
