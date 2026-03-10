import { routeVerification } from "./providers/router";
import type { VerificationResult } from "./types";

function sanitizeClaimText(input: string) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function isTooWeakToVerify(text: string) {
  if (!text) return true;
  if (text.length < 8) return true;
  return false;
}

export async function verifyClaimText(input: string): Promise<VerificationResult> {
  const text = sanitizeClaimText(input);

  if (isTooWeakToVerify(text)) {
    return {
      status: "no_match",
      matches: [],
      message: "Claim too short or unclear to verify.",
    };
  }

  try {
    const result = await routeVerification(text);
    return result;
  } catch (error: any) {
    return {
      status: "error",
      matches: [],
      message: error?.message || "Unexpected verification failure.",
    };
  }
}