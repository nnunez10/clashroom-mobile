import type { ClaimStatus, ReasonCode, Stance } from "@/lib/claim/types";

export type { ClaimStatus, ReasonCode, Stance };

export type StatusStyleKey =
  | "statusMatched"
  | "statusDisputed"
  | "statusUnconfirmed"
  | "statusChecking"
  | "statusNoMatch"
  | "statusError"
  | "statusQueued";

export type StatusPresentation = {
  label: string;
  styleKey: StatusStyleKey;
  /** Diagnostic annotation — does not affect label or style. */
  reasonCode?: ReasonCode;
};

/**
 * Maps (status, stance, reasonCode?) → { label, styleKey, reasonCode }.
 *
 * Stance outranks status for matched/disputed terminal states:
 *   - contradicted → fails closed  ("Contradicted" / statusDisputed)
 *   - unclear      → "Unconfirmed" / statusUnconfirmed
 *   - supported    → falls through to status label ("Matched" / "Disputed")
 *
 * Transient states (checking, queued) and no-result states (no_match, error)
 * are stance-immune — they represent pipeline position, not verdict.
 *
 * reasonCode is a pass-through annotation; it does not change label or styleKey.
 */
export function getStatusPresentation(
  status?: ClaimStatus,
  stance?: Stance,
  reasonCode?: ReasonCode,
): StatusPresentation {
  if (status === "matched" || status === "disputed") {
    if (stance === "contradicted") return { label: "Contradicted", styleKey: "statusDisputed",    reasonCode };
    if (stance === "unclear")      return { label: "Unconfirmed",  styleKey: "statusUnconfirmed", reasonCode };
    // stance === "supported" or undefined: fall through to status label
  }

  switch (status) {
    case "checking": return { label: "Checking",  styleKey: "statusChecking", reasonCode };
    case "matched":  return { label: "Matched",   styleKey: "statusMatched",  reasonCode };
    case "disputed": return { label: "Disputed",  styleKey: "statusDisputed", reasonCode };
    case "no_match": return { label: "No Match",  styleKey: "statusNoMatch",  reasonCode };
    case "error":    return { label: "Error",     styleKey: "statusError",    reasonCode };
    case "queued":   return { label: "Queued",    styleKey: "statusQueued",   reasonCode };
    default:         return { label: "Unknown",   styleKey: "statusQueued",   reasonCode };
  }
}
