// lib/claim/claimCardService.ts
//
// Widget-first ClaimCard creation service.
// Converts raw text into a SavedClaimCard via the verification pipeline,
// with no React dependency and no engine state.
//
// Step 1 skeleton: types + status helper + unimplemented stub.

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

// Suppress unused-variable warning until Step 2 wires the helper in.
void resolveSavedClaimStatus;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildClaimCardFromText(
  _input: BuildClaimCardFromTextInput,
): Promise<ClaimCardResult> {
  throw new Error("buildClaimCardFromText is not implemented yet");
}
