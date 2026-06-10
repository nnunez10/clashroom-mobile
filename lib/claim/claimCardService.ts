// lib/claim/claimCardService.ts
//
// Widget-first ClaimCard creation service.
// Converts raw text into a SavedClaimCard via the verification pipeline,
// with no React dependency and no engine state.
//
// Step 2: normalize input, compute ClaimDNA, create claimId.

import { getClaimDna } from "@/lib/clashbot/claimDna";
import { normalizeClaimInput } from "@/lib/clashbot/normalizeInput";
import { makeId } from "@/lib/clashbot/verificationService";
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
  input: BuildClaimCardFromTextInput,
): Promise<ClaimCardResult> {
  const { raw, normalized } = normalizeClaimInput(input.text);
  if (!raw) throw new Error("buildClaimCardFromText: empty claim text");

  const claimText = normalized || raw;
  const claimId = makeId("claim", `${claimText}_${Date.now()}`);
  const dna = getClaimDna(claimText);

  // Steps 3–6 (verification, snapshot, return) not yet implemented.
  void claimId;
  void dna;
  throw new Error("buildClaimCardFromText is not fully implemented yet");
}
