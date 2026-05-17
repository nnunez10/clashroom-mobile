// lib/clashbot/verdictEngine.ts
//
// Verdict helper functions extracted from ClashBotSheet.tsx.
// These are pure functions — no React, no side effects.

type ClaimItem = {
  status?: "queued" | "checking" | "matched" | "no_match" | "error" | "disputed";
  verification?: {
    top?: { rating?: { text?: string; raw?: string } };
    matches?: { rating?: { text?: string; raw?: string } }[];
    stance?: string;
    resultType?: string;
  } | any;
};

export function getVerdictLabel(claim: ClaimItem): string {
  const verification = claim.verification;
  const ratingText =
    verification?.top?.rating?.text ||
    verification?.top?.rating?.raw ||
    verification?.matches?.[0]?.rating?.text ||
    verification?.matches?.[0]?.rating?.raw ||
    "";

  const normalized = String(ratingText).toLowerCase();
  const stance = verification?.stance;

  if (claim.status === "checking") return "Checking";
  if (claim.status === "queued") return "Queued";
  if (claim.status === "error") return "Error";
  if (claim.status === "no_match") return "Unverified";

  if (stance === "contradicted") return "Contradicted";
  if (stance === "supported") return "Supported";

  if (claim.status === "disputed") return "Weak Match";

  if (normalized.includes("mostly false")) return "Mostly False";
  if (normalized.includes("false")) return "False";
  if (normalized.includes("misleading")) return "Misleading";
  if (normalized.includes("half true")) return "Mixed";
  if (normalized.includes("mixed")) return "Mixed";
  if (normalized.includes("mostly true")) return "Mostly True";
  if (normalized.includes("true")) return "True";
  if (normalized.includes("contradicted")) return "Contradicted";
  if (normalized.includes("supported")) return "Supported";

  if (claim.status === "matched" && stance === "unclear") return "Unconfirmed";
  if (claim.status === "matched") return "Matched";

  return "Unknown";
}

export function getVerdictHit(claim: ClaimItem): string {
  const verification = claim.verification;
  const ratingText =
    verification?.top?.rating?.text ||
    verification?.top?.rating?.raw ||
    verification?.matches?.[0]?.rating?.text ||
    verification?.matches?.[0]?.rating?.raw ||
    "";
  const normalized = String(ratingText).toLowerCase();
  const stance = verification?.stance;

  if (claim.status === "checking") return "CHECKING";
  if (claim.status === "queued") return "QUEUED";
  if (claim.status === "error") return "ERROR";
  if (claim.status === "no_match") return "NO SOURCES";

  // Stance is the strongest signal — resolve first before resultType
  if (stance === "contradicted") return "WRONG";
  if (stance === "supported") return "RIGHT";

  // resultType resolves breaking / mixed coverage without requiring matched status
  if (verification?.resultType === "breaking_coverage") return "TOO EARLY";
  if (verification?.resultType === "mixed") return "UNCLEAR";

  // Rating text fallback for providers that return text verdicts without stance
  if (
    normalized.includes("false") ||
    normalized.includes("misleading") ||
    normalized.includes("mostly false")
  ) {
    return "WRONG";
  }
  if (normalized.includes("mostly true") || normalized.includes("true")) {
    return "RIGHT";
  }

  return "CHECK";
}

export function getReactionLine(claim: ClaimItem): string {
  const verdictHit = getVerdictHit(claim);

  if (verdictHit === "WRONG") return "That's not true.";
  if (verdictHit === "RIGHT") return "That checks out.";
  if (verdictHit === "TOO EARLY") return "Too early to call.";
  if (verdictHit === "UNCLEAR") return "Mixed signals right now.";
  if (verdictHit === "CHECKING") return "Working on it...";
  if (verdictHit === "QUEUED") return "Lining this up now.";
  if (verdictHit === "ERROR") return "Couldn't verify that one.";
  if (verdictHit === "NO SOURCES") return "Nothing solid matched that claim.";

  return "Here's what we found.";
}
