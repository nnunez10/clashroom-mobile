// lib/claim/claimCardService.ts
//
// Widget-first ClaimCard creation service.
// Converts raw text into a SavedClaimCard via the verification pipeline,
// with no React dependency and no engine state.
//
// Step 3: known-fact override path.

import { getClaimDna } from "@/lib/clashbot/claimDna";
import { findKnownFactOverride } from "@/lib/clashbot/knownFacts";
import { normalizeClaimInput } from "@/lib/clashbot/normalizeInput";
import { buildOverrideVerification, makeId } from "@/lib/clashbot/verificationService";
import { snapshotSavedCard } from "./savedCard";
import type { SavedClaimCard } from "./savedCard";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ClaimCardResult = {
  card: SavedClaimCard;
  familyId: string;
  fingerprint: string;
};

export type BuildClaimCardFromTextInput = {
  text: string;
  familyId?: string;
  derivedFromClaimId?: string | null;
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function resolveSavedClaimStatus(
  providerStatus: string,
  stance: string,
  relevant: boolean,
): SavedClaimCard["status"] {
  if (providerStatus === "no_match") return "no_match";
  if (providerStatus === "error") return "error";
  if (!relevant) return "disputed";
  if (stance === "supported") return "matched";
  return "disputed";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildClaimCardFromText(
  input: BuildClaimCardFromTextInput,
): Promise<ClaimCardResult> {
  const { raw, normalized } = normalizeClaimInput(input.text);
  if (!raw) throw new Error("buildClaimCardFromText: empty claim text");

  const claimText = normalized || raw;
  const claimId = makeId("claim", `${claimText}_${Date.now()}`);
  const dna = getClaimDna(claimText);

  // --- Known-fact override path ---
  const override = findKnownFactOverride(claimText);
  if (override) {
    const overrideVerification = buildOverrideVerification(override);
    if (!overrideVerification) throw new Error("buildOverrideVerification returned null unexpectedly");

    const status = resolveSavedClaimStatus("matched", overrideVerification.stance, true);

    const card = snapshotSavedCard({
      id: claimId,
      text: raw,
      status,
      completedAt: Date.now(),
      familyId: dna.familyId,
      derivedFromClaimId: input.derivedFromClaimId ?? null,
      verification: overrideVerification,
    });

    return { card, familyId: dna.familyId, fingerprint: dna.fingerprint };
  }

  // Steps 4–6 (subjective path, API verification, return) not yet implemented.
  throw new Error("buildClaimCardFromText is not fully implemented yet");
}
