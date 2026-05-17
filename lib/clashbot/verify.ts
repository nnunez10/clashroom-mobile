import { routeVerification } from "./providers/router";
import type { VerificationResult } from "./types";
import { classifyClaimIntent, WORTHINESS_THRESHOLD } from "./claimIntent";

function sanitizeClaimText(input: string) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function isTooWeakToVerify(text: string) {
  if (!text) return true;
  if (text.length < 8) return true;
  if (text.split(/\s+/).filter(Boolean).length < 2) return true;
  return false;
}

const CATEGORY_MESSAGES: Record<string, string> = {
  chatter:   "Not a verifiable claim — too conversational.",
  opinion:   "This appears to be a personal opinion, not a verifiable fact.",
  question:  "This is a question rather than a factual claim.",
  rhetorical: "This appears to be a rhetorical statement, not a verifiable fact.",
  subjective: "This is a subjective comparison without a verifiable standard.",
};

export async function verifyClaimText(input: string): Promise<VerificationResult> {
  const text = sanitizeClaimText(input);

  if (isTooWeakToVerify(text)) {
    return {
      status: "no_match",
      matches: [],
      message: "Claim too short or unclear to verify.",
    };
  }

  const intent = classifyClaimIntent(text);

  // [DEBUG] Remove before shipping.
  console.log(
    `[verifyClaimText] category=${intent.category} domain=${intent.domain}` +
    ` worthiness=${intent.worthiness.toFixed(2)} signals=[${intent.signals.join(",")}]`
  );

  if (intent.worthiness < WORTHINESS_THRESHOLD) {
    console.log(
      `[verifyClaimText] suppressed: category=${intent.category}` +
      ` worthiness=${intent.worthiness.toFixed(2)} text="${text.slice(0, 70)}"`
    );
    return {
      status: "no_match",
      matches: [],
      message: CATEGORY_MESSAGES[intent.category] ?? "Claim doesn't meet verification threshold.",
    };
  }

  try {
    const result = await routeVerification(text, intent);
    return result;
  } catch (error: any) {
    return {
      status: "error",
      matches: [],
      message: error?.message || "Unexpected verification failure.",
    };
  }
}
